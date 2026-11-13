# PATPAT: Mobil (Capacitor 8) Kurulum Rehberi

Paket: `com.patpat.game` · Web çıktısı: `dist/` · Ayarlar: `capacitor.config.json`
Platform katmanı (haptic, pause/resume, geri tuşu, paylaşım, yerel hata günlüğü): `src/platform.js`
Durum özeti ve insana kalan işler: `STORE_READINESS.md` §0.

## Gereksinimler
- Node 22+ (Capacitor 8 şartı), `npm install` yapılmış olmalı.
- Android: Android Studio Otter (2025.2.1+) ve JDK 21 (Android Studio ile gelen JBR 21 yeterli).
- iOS: yalnızca Mac üzerinde, Xcode 26+ (iOS 15+ hedef). Windows'ta iOS derlenemez.

## Android: derle ve çalıştır
1. `npm run build`  (`dist/` oluşur; `cap add` öncesi `dist/` var olmalı)
2. `npx cap add android`  (`android/` bu depoda zaten var: bu adımı ATLA; yalnızca klasör silindiyse çalıştır)
3. `npx cap sync android`  (web çıktısını ve pluginleri kopyalar)
4. `npx cap open android`  (Android Studio açılır, Gradle sync bitene kadar bekle)
5. Telefonda Geliştirici Seçenekleri > USB hata ayıklama aç, kabloyu tak, Android Studio'da cihazı seç, Run.

Kısayol: `npm run cap:android` (build + sync + open). Kodu her değiştirdiğinde adım 1 ve 3'ü tekrarla
(`npm run cap:sync`). Chrome'da `chrome://inspect` ile WebView'i debug edebilirsin.

## Dikey (portrait) kilidi
Android, `android/app/src/main/AndroidManifest.xml`:
```xml
<application ... android:appCategory="game">
    <activity ... android:screenOrientation="portrait">
```
`appCategory="game"` önemli: Android 16'da (API 36) büyük ekranlarda yön/yeniden boyutlandırma kilitleri
yok sayılıyor, oyun olarak işaretli uygulamalar bu kuraldan muaf.

iOS, `ios/App/App/Info.plist`:
- `UISupportedInterfaceOrientations` = sadece `UIInterfaceOrientationPortrait`
- `UISupportedInterfaceOrientations~ipad` de portrait; iPad'te tek yön için `UIRequiresFullScreen` = YES
- `UIViewControllerBasedStatusBarAppearance` = YES (SystemBars ile durum çubuğunu gizlemek için gerekli)

## Tam ekran ve güvenli alan
- `index.html` içinde `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` olmalı.
- Android 15+ ekranı kenardan kenara zorlar. HUD'u çentik ve jest çubuğundan kaçırmak için
  `env(safe-area-inset-*)` ya da Capacitor'ın eklediği `--safe-area-inset-*` CSS değişkenlerini kullan.
- Sistem çubukları `plugins.SystemBars.hidden: true` ile açılışta gizlenir; `platform.init()` ayrıca `hide()` çağırır.
- Android'de ayrıca `MainActivity.java` (`android/app/src/main/java/com/patpat/game/`) immersive tam ekran uygular: pencere odağı geri gelince durum + gezinme çubuklarını gizler, kenardan kaydırma çubukları geçici gösterir (`BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`). Gerçek cihazda geri jesti / çentik ile dene.
- Web sürümü: `public/manifest.webmanifest` (`display: fullscreen`, `orientation: portrait`, tek ikon `favicon.svg`), `index.html` içinde `theme-color` ve `apple-mobile-web-app-capable`. PWA olarak yüklenebilir ikon için PNG 192 / 512 eklenmedi (Play paketi için gerekmez).

## iOS (Mac + Xcode 26)
1. `npm run build` → `npx cap add ios` (ilk sefer) → `npx cap sync ios` → `npx cap open ios`
2. Xcode: Signing & Capabilities'te Team seç, bundle id `com.patpat.game` (iOS için kararı sahibi verir).
3. Gerçek cihaz veya simulatör seç, Run.

## 2026 yayın kontrol listesi
Google Play
- [ ] Target API 36 (Capacitor 8 varsayılanı 36; `android/variables.gradle` kontrol et), minSdk 24.
- [ ] Sürüm: `package.json` `version`, `android/app/build.gradle` `versionName` ve oyun içi `VERSION` (`src/menus.js`) hep aynı olmalı (şu an `1.0.0`); `versionCode` her Play yüklemesinde artmalı (şu an 1).
- [ ] İmza: `android/app/build.gradle` içindeki yorumlu `signingConfigs` bloğu yer tutucudur; upload keystore'u depo DIŞINDA üret, parolaları `~/.gradle/gradle.properties` veya ortam değişkenlerinden (`PATPAT_UPLOAD_*`) ver, sonra yorumu kaldır. Depoya keystore / parola koyma.
- [ ] AAB üret: Android Studio > Build > Generate Signed App Bundle (veya `./gradlew bundleRelease`). Release derlemesinde R8 (`minifyEnabled` + `shrinkResources`) açık: yayından önce release derlemesini gerçek cihazda dene (bildirim, haptik, paylaşım, geri tuşu).
- [ ] Upload keystore'u güvenli yere yedekle; Play App Signing'i aç.
- [ ] Yeni kişisel geliştirici hesabı: Production öncesi kapalı testte en az 12 test kullanıcısı, 14 gün kesintisiz.
- [ ] Data Safety formu: geliştirici sunucusu yok, ama IP adresi üçüncü taraflara gidiyor (Google Fonts menü yazı tipi, Arena için PeerJS / Nostr röleleri / STUN-TURN). "Hiçbir veri toplanmıyor" demek riskli: `STORE_READINESS.md` §5'teki cevap taslağını kullan. Reklam eklenirse güncelle.
- [ ] `capacitor.config.json` içinde `loggingBehavior` üç yerde de `"none"` (yapıldı); `SCHEDULE_EXACT_ALARM` izni manifest'ten `tools:node="remove"` ile çıkarıldı (yapıldı; hatırlatmaların yaklaşık zamanlı çalıştığını cihazda doğrula).
- [ ] `android:allowBackup="false"` (bilinçli karar, manifest'te açıklandı): yeni telefonda ilerleme sıfırdan başlar; istersen `true` yap ve `dataExtractionRules` ekle. Gizlilik politikası her iki durumda da doğru.
- [ ] Ana ekran düzeni gerçek cihazda: OYNA, altında MACERA + ÇIĞ yan yana (her biri iki satır: ad + `Bölüm N · ⭐ n/300` / `KASABA AVI · n/40`), en altta 4 küçük düğme. 320x568, 360x640, 430x932 ve çentikli ekranda taşma / kesilme / alt jest çubuğu çakışması yok mu bak (TR ve EN; EN etiketler daha uzun).
- [ ] Gizlilik politikası URL'i, içerik derecelendirme anketi, hedef kitle, mağaza görselleri (ikon 512, feature graphic 1024x500, telefon ekran görüntüleri).

App Store
- [ ] Mac + Xcode 26 ile arşivle (Product > Archive), App Store Connect'e yükle (TestFlight ile dene).
- [ ] `ios/App/App/PrivacyInfo.xcprivacy` dosyası: `@capacitor/preferences` (UserDefaults) kullanırsan
      `NSPrivacyAccessedAPICategoryUserDefaults` için neden kodu `CA92.1`. Toplanan veri yoksa `NSPrivacyCollectedDataTypes` boş.
- [ ] 6.9" iPhone ekran görüntüleri (1320x2868), uygulama ikonu 1024x1024, yaş derecelendirme anketi, gizlilik politikası URL'i, App Privacy cevapları.
- [ ] Dikey kilit ve durum çubuğu ayarlarını gerçek cihazda doğrula.

İkon ve açılış ekranı: `@capacitor/assets` ile tek kaynak görselden üretilebilir
(`npx @capacitor/assets generate`); varsayılan Capacitor ikonunu yayına bırakma.

## Sonra: reklam (AdMob)
- `@capacitor-community/admob` 8.x kur, `npx cap sync`.
- Android `AndroidManifest.xml` içine `com.google.android.gms.ads.APPLICATION_ID` meta-data, iOS `Info.plist` içine
  `GADApplicationIdentifier` ve `SKAdNetworkItems` ekle. Geliştirirken sadece Google test reklam ID'lerini kullan.
- UMP (User Messaging Platform) onay formu: AB/Birleşik Krallık/İsviçre kullanıcıları için reklamdan önce göster.
- iOS için ATT: `NSUserTrackingUsageDescription` metni + izin penceresi (UMP'den sonra).
- Reklam eklenince Data Safety, App Privacy ve gizlilik politikasını güncelle; `app-ads.txt` yayınla.

## Hata günlüğü ve değerlendirme isteği
- `window.onerror` ve `unhandledrejection` son 20 kaydı `localStorage` (`patpat.errlog`) içinde tutar; ağ yok. Ayarlar > "Hata bildir" günlüğü panoya kopyalar (kullanıcı e-postayla gönderir).
- Mağaza değerlendirme isteği: 3. kişisel rekorda `platform.requestReview()` çağrılır. Şimdilik BOŞ bir kanca (yeni bağımlılık eklenmedi); yayın için `@capacitor-community/in-app-review` kurup `src/platform.js` içindeki `requestReview()` gövdesini doldur.
