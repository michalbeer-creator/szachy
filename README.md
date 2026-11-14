# Szachy

Szachy na Androida (APK). Tryby:

- **Dwóch graczy** na jednym telefonie (z cofaniem ruchów i obracaniem planszy),
- **Gra z komputerem** – 3 poziomy, wybór koloru,
- **Gra na dwóch telefonach** – Google Nearby Connections (Bluetooth / Wi-Fi, bez internetu i bez serwera), jeden telefon zakłada grę, drugi dołącza. Po zerwaniu połączenia telefony łączą się ponownie i synchronizują partię. Można zaproponować remis, poddać się i zagrać rewanż (kolory na zmianę).

Pełne zasady (biblioteka [chess.js](https://github.com/jhlywa/chess.js)): roszada, bicie w przelocie, promocja z wyborem figury, szach, mat, pat, remis przez trzykrotne powtórzenie, 50 ruchów i brak materiału.

## Pobieranie

Najnowszy APK: https://github.com/michalbeer-creator/szachy/releases/latest/download/Szachy.apk

## Budowanie

Każdy push na `main` buduje APK w GitHub Actions i publikuje Release `v1.0.<numer>`.

Lokalnie:

```
npm ci && npm run build      # gra (JS) -> app/src/main/assets
./gradlew assembleRelease    # APK (wymaga Android SDK)
```

Test w przeglądarce: serwer HTTP w `app/src/main/assets`, a gra na dwóch telefonach w dwóch kartach z `index.html?mocknet`.

Figury: font Noto Sans Symbols 2 (SIL Open Font License).
