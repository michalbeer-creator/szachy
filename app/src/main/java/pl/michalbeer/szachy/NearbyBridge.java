package pl.michalbeer.szachy;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;


import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.nearby.Nearby;
import com.google.android.gms.nearby.connection.AdvertisingOptions;
import com.google.android.gms.nearby.connection.ConnectionInfo;
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback;
import com.google.android.gms.nearby.connection.ConnectionResolution;
import com.google.android.gms.nearby.connection.ConnectionsClient;
import com.google.android.gms.nearby.connection.ConnectionsStatusCodes;
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo;
import com.google.android.gms.nearby.connection.DiscoveryOptions;
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback;
import com.google.android.gms.nearby.connection.Payload;
import com.google.android.gms.nearby.connection.PayloadCallback;
import com.google.android.gms.nearby.connection.PayloadTransferUpdate;
import com.google.android.gms.nearby.connection.Strategy;

import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Most między grą (JS w WebView) a Google Nearby Connections.
 * JS woła metody oznaczone @JavascriptInterface (obiekt window.NearbyNative),
 * a zdarzenia trafiają do JS przez window.onNearby({type: ...}).
 */
public class NearbyBridge {
    static final int PERM_REQUEST = 4242;
    private static final String SERVICE_ID = "pl.michalbeer.szachy.partia";
    private static final Strategy STRATEGY = Strategy.P2P_POINT_TO_POINT;

    private final Activity act;
    private final WebView web;
    private final ConnectionsClient client;
    private final Handler main = new Handler(Looper.getMainLooper());

    private String endpointId;        // aktualnie połączony przeciwnik
    private String pendingAction;     // "host" / "join" czekające na uprawnienia
    private String pendingName;

    NearbyBridge(Activity act, WebView web) {
        this.act = act;
        this.web = web;
        this.client = Nearby.getConnectionsClient(act);
    }

    // ---------- zdarzenia do JS ----------

    private void emit(JSONObject o) {
        final String js = "window.onNearby && window.onNearby(" + o.toString() + ")";
        main.post(() -> web.evaluateJavascript(js, null));
    }

    private void emit(String type, Object... kv) {
        try {
            JSONObject o = new JSONObject();
            o.put("type", type);
            for (int i = 0; i + 1 < kv.length; i += 2) o.put((String) kv[i], kv[i + 1]);
            emit(o);
        } catch (JSONException ignored) { }
    }

    private void emitError(String where, Exception e) {
        int code = -1;
        if (e instanceof ApiException) code = ((ApiException) e).getStatusCode();
        String name = code >= 0 ? ConnectionsStatusCodes.getStatusCodeString(code) : String.valueOf(e.getMessage());
        emit("error", "where", where, "code", code, "message", name);
    }

    // ---------- uprawnienia ----------

    private String[] requiredPermissions() {
        List<String> p = new ArrayList<>();
        int sdk = Build.VERSION.SDK_INT;
        if (sdk >= Build.VERSION_CODES.S) {
            p.add(Manifest.permission.BLUETOOTH_SCAN);
            p.add(Manifest.permission.BLUETOOTH_ADVERTISE);
            p.add(Manifest.permission.BLUETOOTH_CONNECT);
        }
        if (sdk >= Build.VERSION_CODES.TIRAMISU) {
            p.add(Manifest.permission.NEARBY_WIFI_DEVICES);
        } else {
            // Android 8–12: Nearby wymaga lokalizacji do skanowania Bluetooth/Wi-Fi
            p.add(Manifest.permission.ACCESS_FINE_LOCATION);
        }
        return p.toArray(new String[0]);
    }

    private List<String> missingPermissions() {
        List<String> miss = new ArrayList<>();
        for (String perm : requiredPermissions()) {
            if (act.checkSelfPermission(perm) != PackageManager.PERMISSION_GRANTED) miss.add(perm);
        }
        return miss;
    }

    /** Zwraca true, jeśli można działać od razu; w przeciwnym razie prosi o uprawnienia. */
    private boolean ensurePermissions(String action, String name) {
        List<String> miss = missingPermissions();
        if (miss.isEmpty()) return true;
        pendingAction = action;
        pendingName = name;
        act.requestPermissions(miss.toArray(new String[0]), PERM_REQUEST);
        return false;
    }

    void onPermissionsResult(int requestCode, int[] results) {
        if (requestCode != PERM_REQUEST) return;
        String action = pendingAction, name = pendingName;
        pendingAction = null;
        boolean ok = results.length > 0;
        for (int r : results) ok &= r == PackageManager.PERMISSION_GRANTED;
        if (!ok || !missingPermissions().isEmpty()) {
            boolean never = false;
            for (String perm : missingPermissions()) {
                if (!act.shouldShowRequestPermissionRationale(perm)) never = true;
            }
            emit("permission-denied", "permanent", never);
            return;
        }
        if ("host".equals(action)) startHost(name);
        else if ("join".equals(action)) startJoin(name);
    }

    // ---------- host / dołączanie ----------

    private void startHost(String name) {
        client.stopDiscovery();
        AdvertisingOptions opts = new AdvertisingOptions.Builder().setStrategy(STRATEGY).build();
        client.startAdvertising(name, SERVICE_ID, lifecycle, opts)
                .addOnSuccessListener(v -> emit("hosting"))
                .addOnFailureListener(e -> {
                    if (isAlready(e, ConnectionsStatusCodes.STATUS_ALREADY_ADVERTISING)) emit("hosting");
                    else emitError("advertise", e);
                });
    }

    private void startJoin(String name) {
        client.stopAdvertising();
        pendingName = name;
        DiscoveryOptions opts = new DiscoveryOptions.Builder().setStrategy(STRATEGY).build();
        client.startDiscovery(SERVICE_ID, discovery, opts)
                .addOnSuccessListener(v -> emit("discovering"))
                .addOnFailureListener(e -> {
                    if (isAlready(e, ConnectionsStatusCodes.STATUS_ALREADY_DISCOVERING)) emit("discovering");
                    else emitError("discover", e);
                });
    }

    private static boolean isAlready(Exception e, int code) {
        return e instanceof ApiException && ((ApiException) e).getStatusCode() == code;
    }

    private final EndpointDiscoveryCallback discovery = new EndpointDiscoveryCallback() {
        @Override
        public void onEndpointFound(String id, DiscoveredEndpointInfo info) {
            if (!SERVICE_ID.equals(info.getServiceId())) return;
            emit("found", "id", id, "name", info.getEndpointName());
        }

        @Override
        public void onEndpointLost(String id) {
            emit("lost", "id", id);
        }
    };

    private final ConnectionLifecycleCallback lifecycle = new ConnectionLifecycleCallback() {
        @Override
        public void onConnectionInitiated(String id, ConnectionInfo info) {
            if (endpointId != null && !endpointId.equals(id)) {
                client.rejectConnection(id); // już gramy z kimś innym
                return;
            }
            client.acceptConnection(id, payloads);
            emit("connecting", "id", id, "name", info.getEndpointName());
        }

        @Override
        public void onConnectionResult(String id, ConnectionResolution res) {
            int code = res.getStatus().getStatusCode();
            if (code == ConnectionsStatusCodes.STATUS_OK) {
                endpointId = id;
                client.stopAdvertising();
                client.stopDiscovery();
                emit("connected", "id", id);
            } else {
                emit("connect-failed", "id", id, "code", code,
                        "message", ConnectionsStatusCodes.getStatusCodeString(code));
            }
        }

        @Override
        public void onDisconnected(String id) {
            if (id.equals(endpointId)) endpointId = null;
            emit("disconnected", "id", id);
        }
    };

    private final PayloadCallback payloads = new PayloadCallback() {
        @Override
        public void onPayloadReceived(String id, Payload payload) {
            if (payload.getType() != Payload.Type.BYTES || payload.asBytes() == null) return;
            String msg = new String(payload.asBytes(), StandardCharsets.UTF_8);
            try {
                JSONObject o = new JSONObject();
                o.put("type", "message");
                o.put("data", msg);
                emit(o);
            } catch (JSONException ignored) { }
        }

        @Override
        public void onPayloadTransferUpdate(String id, PayloadTransferUpdate update) { }
    };

    // ---------- API dla JS ----------

    @JavascriptInterface
    public String status() {
        int gms = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(act);
        return "{\"gms\":" + (gms == ConnectionResult.SUCCESS) + ",\"connected\":" + (endpointId != null) + "}";
    }

    @JavascriptInterface
    public void host(String name) {
        main.post(() -> { if (ensurePermissions("host", name)) startHost(name); });
    }

    @JavascriptInterface
    public void join(String name) {
        main.post(() -> { if (ensurePermissions("join", name)) startJoin(name); });
    }

    @JavascriptInterface
    public void connect(String id, String myName) {
        main.post(() -> client.requestConnection(myName, id, lifecycle)
                .addOnFailureListener(e -> {
                    if (isAlready(e, ConnectionsStatusCodes.STATUS_ALREADY_CONNECTED_TO_ENDPOINT)) return;
                    emitError("connect", e);
                    emit("connect-failed", "id", id, "code",
                            e instanceof ApiException ? ((ApiException) e).getStatusCode() : -1,
                            "message", String.valueOf(e.getMessage()));
                }));
    }

    @JavascriptInterface
    public void send(String data) {
        main.post(() -> {
            if (endpointId == null) return;
            client.sendPayload(endpointId, Payload.fromBytes(data.getBytes(StandardCharsets.UTF_8)))
                    .addOnFailureListener(e -> emitError("send", e));
        });
    }

    @JavascriptInterface
    public void openSettings() {
        main.post(() -> {
            android.content.Intent i = new android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    android.net.Uri.fromParts("package", act.getPackageName(), null));
            act.startActivity(i);
        });
    }

    /** Zatrzymuje szukanie/ogłaszanie, ale nie zrywa połączenia. */
    @JavascriptInterface
    public void stopSearch() {
        main.post(() -> { client.stopAdvertising(); client.stopDiscovery(); });
    }

    /** Kończy wszystko: rozłącza i przestaje szukać. */
    @JavascriptInterface
    public void stop() {
        main.post(this::shutdown);
    }

    void shutdown() {
        client.stopAdvertising();
        client.stopDiscovery();
        client.stopAllEndpoints();
        endpointId = null;
    }
}
