# PATPAT: Mağaza Hazırlık Değerlendirmesi (App Store / Google Play)

Tarih: 19 Ekim 2026 · Kapsam: bu depo (Capacitor 8 + Vite 8 + Three.js 0.186), `fix/junction-wall-and-polish` dalı · Hazırlayan: kod ve yapılandırma incelemesi (cihazda test yapılmadı).

---

## 1. Kısa cevap

**Hazır değil. Oyun teknik olarak oynanabilir ve büyük ölçüde çevrimdışı çalışıyor; ama bugün gönderilirse reddedilme veya kötü ilk izlenim riski yüksek.**

| Mağaza | Durum | Tahmini toparlanma süresi (tek kişi) |
|---|---|---|
| Google Play | Engelleyiciler var, hepsi çözülebilir | ~4-6 iş günü + kişisel hesapsa 14 günlük kapalı test |
| App Store | `ios/` projesi hiç oluşturulmamış; Android engelleyicilerine ek olarak Mac/Xcode işi var | Android süresine + ~3-5 iş günü |

Engelleyicilerin özeti (ayrıntı §3):

1. Varsayılan Capacitor ikonu ve açılış ekranı (mavi çarpı) duruyor.
2. `capacitor.config.json` içinde `loggingBehavior: "debug"` (3 yerde); yayında `"none"` olmalı.
3. Release imzalama yapılandırması yok (`signingConfigs` yok), sürüm numaraları tutarsız.
4. Gizlilik politikası yayında değil / iletişim bilgisi boş; Data Safety ve App Privacy formları cevaplanmadı.
5. KARTOPU ARENA'da yabancılarla serbest metin sohbet var; şikayet / engelleme / moderasyon yok (UGC kuralları).
6. İlk sürüm için gerçek cihaz testi (düşük/orta Android, iPhone) yapılmamış.
7. Mağaza görselleri ve metinleri hazır değil.

İyi haberler: oyunda **reklam, analitik, hesap, izleme, oyun içi satın alma yok**; gizlilik beyanı bu yüzden basit; ses ve modeller CC0 / CC0 uyumlu; hedef API 36; dikey kilit var; çevrimdışı çalışıyor.

---

## 2. Neye bakıldı: bulgular

Durum: ✅ tamam · ⚠️ kısmen / dikkat · ❌ eksik

| Alan | Durum | Bulgu (kanıt) |
|---|---|---|
| Uygulama kimliği | ⚠️ | `com.patpat.game` (`capacitor.config.json`, `android/app/build.gradle`). `MOBILE.md` hâlâ eski `com.cigoyunu.kartopu` yazıyor; iOS bundle id'si kararlaştırılmalı. |
| Android projesi | ⚠️ | `android/` var (53 dosya). `targetSdk 36`, `minSdk 24`, `appCategory=game`, `screenOrientation=portrait` ✅. Manifest'te `INTERNET` + `POST_NOTIFICATIONS`; eklentilerden birleşen izinler: `VIBRATE` (haptics), `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`, **`SCHEDULE_EXACT_ALARM`** (local-notifications). Sonuncusu Play'de gerekçe isteyen kısıtlı izin; oyun tam zamanlı alarma ihtiyaç duymuyor (S11). |
| Android sürüm | ❌ | `versionCode 1`, `versionName "1.0"`; `package.json` `0.1.0`; oyun içi sürüm (`menus.js` `VERSION`) `0.3.0`. Üçü de farklı. |
| Android imzalama | ❌ | `android/app/build.gradle` içinde `signingConfigs` / release imzası yok; `minifyEnabled false`. |
| Android ikon / açılış | ❌ | `mipmap-*/ic_launcher*.png` ve `drawable*/splash.png` varsayılan Capacitor görselleri (mavi çarpı). |
| Android yedekleme | ⚠️ | `allowBackup="true"`, `dataExtractionRules` yok: localStorage verisi Google yedeğine girebilir. Karar verilmeli (bilinçli bırakmak da olur; gizlilik metninde belirtildi). |
| iOS projesi | ❌ | `ios/` klasörü yok (`@capacitor/ios` devDependency var, `npx cap add ios` yapılmamış). Mac + Xcode 26 gerekir. |
| Capacitor loglama | ❌ | `loggingBehavior: "debug"` hem kökte hem `android` hem `ios` altında. Yayında `"none"`. |
| Çevrimdışı | ✅ | Modeller (`public/models`, ~1,1 MB) ve sesler (`public/sfx`, ~0,7 MB) pakete giriyor; `fetch` yolları göreli. Toplam `dist/` ~4,1 MB. |
| Ağ çağrıları | ⚠️ | §4'te envanter. İki ağ kullanımı var: Google Fonts (menü yazı tipi) ve Arena çevrim içi odalar. |
| Reklam / analitik | ✅ | Yok. `meta.track()` (`src/meta.js`) tamamen yerel: görev/başarım sayaçlarını `localStorage`'a yazar, ağ çağrısı yok. |
| Gelir modeli | ✅ | Yok. Para birimleri (❄️, 💎) yalnızca oynayarak kazanılıyor; sürpriz kutu / çark ücretsiz. `DESIGN.md`, `RUNNER.md`, `MOBILE.md` "ileride rewarded reklam" diyor; koda girmedi. |
| Gizlilik | ⚠️ | Kişisel veri toplanmıyor, cihaz kimliği / parmak izi yok. Ama IP adresi üçüncü taraflara gidiyor (Google Fonts, PeerJS, Nostr röleleri, STUN/TURN). Politika bu dalda yazıldı (`public/privacy.html`, `PRIVACY.md`). |
| Yaş derecelendirmesi | ⚠️ | Çizgi film şiddeti (Yeti kovalaması, topun patlaması, yaratık ezme, ÇIĞ'da araç / insan yutma). Sohbet nedeniyle "kullanıcılar etkileşir" işareti çıkar. §6. |
| Hukuk / lisans | ⚠️ | Kenney (CC0) ve rubberduck / OpenGameArt (CC0) kredisi `public/*/CREDITS.txt` ve Ayarlar'da ✅. MIT kütüphaneler (three, peerjs, trystero, @capacitor/*) için bildirim ekranı yok. İsim çakışması riski §7. |
| Müzik | ✅ | Prosedürel (`src/runner/music.js`, `src/audio.js`); `public/` içinde başka ses / müzik dosyası yok. |
| Çökme raporlama | ❌ | Yok. `window.onerror` / `unhandledrejection` dinleyicisi yok. Yerel çökmeleri yalnızca Play Console / Xcode Organizer görür; WebView içi JS hataları görünmez. |
| Performans | ⚠️ | Bütçe tanımlı (runner: ≤25 draw call, ≤80k üçgen, gölge haritası yok) ama gerçek cihaz ölçümü / otomatik test yok. `webglcontextlost` → duraklatır. |
| Erişilebilirlik | ⚠️ | Ses / titreşim açma-kapama ✅, `prefers-reduced-motion` (bu dalda HUD için eklendi) ✅. Küçük yazılar (9-12 px), renkle verilen uyarılar, ekran okuyucu yok. §8. |
| Yerelleştirme | ✅ | TR + EN (`src/i18n/en_*.js`, DOM çevirici), dil Ayarlar'dan değişiyor. Mağaza metni iki dilde hazırlanmalı. |
| Paylaşım | ⚠️ | Paylaşım kartı üretiliyor. Native uygulamada `location.origin` `https://localhost` olduğu için bağlantı ölüydü; bu dalda `shareUrl()` ile düzeltildi. Arena davet bağlantısı (`src/agar/invite.js`) hâlâ aynı hatayı taşıyor. WebView'de Web Share / blob indirme cihazda doğrulanmalı. |

---

## 3. Öncelikli kontrol listesi

Efor: **S** ≤ 2 saat · **M** 0,5-1 gün · **L** 2-5 gün. (Tek geliştirici, tahmini.)

### 3.1 Engelleyiciler (göndermeden önce şart)

| # | İş | Neden | Efor | Nerede |
|---|---|---|---|---|
| B1 | `loggingBehavior` → `"none"` (3 yerde) | Yayında hata ayıklama günlüğü açık kalmasın | S (5 dk) | `capacitor.config.json` |
| B2 | Gerçek uygulama ikonu (adaptive dâhil) + açılış ekranı | Varsayılan Capacitor ikonu düşük kalite sinyali, mağaza listesinde kötü görünür. Tek kaynak 1024×1024 görselden `npx @capacitor/assets generate` | M (tasarım dâhil) | `android/app/src/main/res/*`, iOS'ta `ios/App/App/Assets.xcassets` |
| B3 | Release imzası + AAB: upload keystore, `signingConfigs`, Play App Signing; `versionCode` / `versionName` politikası (3 sürüm numarasını eşitle) | AAB imzasız yüklenemez | S-M | `android/app/build.gradle`, `package.json`, `src/menus.js` (`VERSION`) |
| B4 | Gizlilik politikasını yayınla (GitHub Pages `privacy.html`) ve `[GELİŞTİRİCİ ADI]` / `[İLETİŞİM E-POSTASI]` alanlarını doldur; Play **Data safety** + Apple **App Privacy** formlarını §5'e göre cevapla | İki mağaza da politika URL'i + beyan ister | S | `public/privacy.html`, `PRIVACY.md` |
| B5 | Arena sohbeti: ya serbest metni kaldır (yalnızca hazır cümleler) ya da şikayet + engelleme + kullanıcı adı filtresi ekle. "HIZLI OYNA" kullanıcıyı yabancıların herkese açık odasına atıyor veya herkese açık oda kuruyor: ilk kullanımda kısa bir bilgilendirme / onay ekle | Apple 1.2 (UGC: filtre, şikayet, engelleme, iletişim) ve Play UGC politikası. En ucuz çözüm: serbest metin girişini kapat (`.ag-cin`), hazır cümleler (`.ag-cq`) kalsın | S (serbest metni kapat) / M (tam moderasyon araçları) | `src/agar/agar.js` |
| B6 | Gerçek cihaz testi: ≥2 düşük/orta Android (2-3 GB RAM), 1 iPhone; FPS, ısınma, geri tuşu, çentik / jest çubuğu, bildirim izni, paylaşım kartı, çevrimdışı açılış, arka plana alıp dönme | Test edilmemiş sürüm göndermek reddedilme + kötü yorum demek | M | — |
| B7 | Mağaza varlıkları ve metinleri (§6) | Gönderi formu boş geçilemez | M | — |
| B8 | **Yalnızca iOS:** `npx cap add ios`, bundle id kararı, imzalama (Apple Developer hesabı), `PrivacyInfo.xcprivacy`, dikey kilit + `UIRequiresFullScreen`, TestFlight denemesi, `ITSAppUsesNonExemptEncryption` | `ios/` yok; Windows'ta derlenemez | L | Mac + Xcode 26 |
| B9 | **Yalnızca Play, kişisel geliştirici hesabı:** üretimden önce kapalı testte ≥12 test kullanıcısı, 14 gün kesintisiz (`MOBILE.md`'deki güncel kural; Console'da doğrula) | Üretime çıkış takvimini belirler: bugünden başlat | 14 gün (paralel) | Play Console |

### 3.2 Olmazsa olmaz değil ama yapılmalı (should-have)

| # | İş | Neden | Efor |
|---|---|---|---|
| S1 | Menü yazı tipini pakete göm (Lilita One, SIL OFL, ~25 KB woff2) ve `menus.js` içindeki Google Fonts bağlantısını kaldır | Çevrimdışı görünüm tutarlı olur; IP'nin Google'a gitmesi biter (KVKK / GDPR hassasiyeti); Data Safety beyanı sadeleşir. Not: yazı tipi dosyasını indirmek ve lisansını eklemek sahibin onayı ister, bu dalda yapılmadı | S |
| S2 | Hata yakalama: `window.onerror` + `unhandledrejection` → yerel halka tampon; Ayarlar'da "Hata bildir" (e-posta taslağı açar, ağ yok) | JS çökmeleri hiçbir yerde görünmüyor | S-M |
| S3 | Native paylaşım: Web Share API + blob indirme WebView'de çalışmıyorsa `@capacitor/share` (+ `@capacitor/filesystem`) ekle; `src/agar/invite.js` içinde `location.origin` yerine `shareUrl()` kullan | Paylaşım viral büyümenin ana kapısı | M |
| S4 | Açık kaynak lisansları ekranı (three.js, peerjs, trystero, @capacitor/*: MIT bildirimi) + kredilerde Lilita One (OFL) | MIT bildirim şartı | S |
| S5 | Android: release için R8 (`minifyEnabled true`, `shrinkResources`), `allowBackup` / `dataExtractionRules` kararı | Boyut, yedekleme beyanı | S |
| S6 | Düşük cihaz kalite basamağı: ilk çalıştırmada kare süresi kötüyse otomatik hafif görünüm / piksel oranı düşürme (`src/main.js` `dpr`) | Orta seviye telefon hedefi | M |
| S7 | Metin boyutu ve kontrast taraması: 11 px altı yazıları büyüt, renk körü için uyarıları şekille de ver | Erişilebilirlik; mağaza incelemesi sezgisi | M |
| S8 | `MOBILE.md` güncelle: bundle id (`com.patpat.game`), "Data Safety: toplanmıyor" cümlesi artık doğru değil (§5) | Yanlış rehber | S |
| S9 | EN modda tam gezinti testi: Türkçe karakter kaçıyor mu? (çalışma zamanında kurulan metinler sözlüğe girmemiş olabilir) | Mağazada EN kullanıcılar | S |
| S10 | Mağaza adı / marka taraması ("PATPAT" benzeri adlar, §7) | Marka itirazı = yayından kaldırma | S |
| S11 | `AndroidManifest.xml`'e `<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" tools:node="remove" />` ekle (manifest `xmlns:tools` ile) | Hatırlatmalar (`src/platform.js`) saat başı hassasiyet gerektirmiyor; izin kaldırılınca eklenti yaklaşık zamanlı alarma düşer (cihazda doğrula). İzin kalırsa Play'de beyan formu / ret riski | S |

### 3.3 Güzel olurdu (nice-to-have)

| # | İş | Efor |
|---|---|---|
| N1 | Bulut kayıt (Play Games / Game Center) ve başarım / liderlik tablosu entegrasyonu | L |
| N2 | Değerlendirme isteği (uygun anda, 3. rekor gibi) | S |
| N3 | Tanıtım videosu, mağaza ekran görüntüsü başlıkları, ASO denemeleri | M |
| N4 | Ek diller (DE, ES, RU, AR...) | M/dil |
| N5 | Tablet / katlanabilir ekran düzenleri (Android 16 büyük ekranda yön kilidini yok sayar; oyun kategorisi muaf ✅) | M |
| N6 | Rewarded reklam (AdMob): "BENİ KURTAR", 2x ödül. Eklenirse: UMP onayı, iOS ATT, `app-ads.txt`, Data Safety / App Privacy / politika güncellemesi, Families kuralları | L |
| N7 | Kendi sunucusu olan eşleştirme (PeerJS Cloud / Nostr yerine): üçüncü taraf bağımlılığı ve IP paylaşımı azalır | L |
| N8 | Otomatik performans / duman testi (CI'de `check:camera` benzeri betikler) | M |

---

## 4. Ağ çağrıları envanteri (koddan doğrulandı)

| Ne | Ne zaman | Kime gidiyor | Kaynak |
|---|---|---|---|
| Menü yazı tipi CSS'i (`Lilita One`) | Menü açılırken, internet varsa | `fonts.googleapis.com` (+ `fonts.gstatic.com`) | `src/menus.js` `injectStyle()` |
| Arena oda keşfi | "HIZLI OYNA", "AÇIK ODALAR", herkese açık oda kurma | Trystero → herkese açık Nostr röleleri (WebSocket; ör. `relay.*`, `nostr.*` listesi kütüphanede), STUN `stun.cloudflare.com` | `src/agar/lobby.js` |
| Arena oyun bağlantısı | Tüm çevrim içi odalar (özel oda / kodla katıl dâhil) | PeerJS Cloud `0.peerjs.com`, STUN `stun.l.google.com:19302`, TURN `*.turn.peerjs.com`; oyuncular arası WebRTC | `src/agar/net.js` |
| Bildirimler | Yalnızca native; 2. koşudan sonra izin sorulur | Ağ yok (yerel `LocalNotifications`) | `src/platform.js`, `src/main.js` `notifSync()` |
| Paylaşım | PAYLAŞ'a basınca | Ağ yok (işletim sistemi paylaşım penceresi / indirme / pano) | `src/sharecard.js` |
| Diğer `fetch` | Açılışta | Yalnızca kendi paketindeki `kenney.json/.bin` ve `*.ogg` | `src/assets.js`, `src/sfx.js` |

Bulunmayanlar: analitik, reklam, çerez (`document.cookie` yok), konum, kamera, mikrofon, cihaz / reklam kimliği, `navigator.userAgent` okuma.

Depolanan `localStorage` anahtarları: `cig.save.v1`, `freemon.meta.v1`, `patpat.season`, `patpat.dtask.v1`, `patpat.agar.*` (takma ad, rekor, xp), `patpat_lang`, `cig.muted`, `cig.music.muted`, `cig.haptics`, `cig.visual`, `cig.notifAsked`, `patpat.ftue*`, `patpat.lastMode`, `patpat.dailyRush`, `patpat.stampsSeen` vb.

---

## 5. Gizlilik beyanları için cevap taslağı

> Doğru cevap hukuki yoruma bağlı; aşağıdakiler kodun gerçekte yaptığına dayalı **ihtiyatlı** taslaktır. Formları doldururken Google / Apple tanımlarını tekrar okuyun.

**Google Play · Data safety**
- Uygulama veri topluyor mu / paylaşıyor mu? Sunucumuz yok: geliştirici olarak veri toplamıyoruz. Ancak IP adresi üçüncü taraf servislere (Google Fonts, PeerJS, Nostr röleleri, STUN/TURN) gidiyor; bu yüzden "hiçbir veri toplanmıyor" demek riskli. Güvenli yol: bu servisleri açıkça beyan etmek veya S1 ile Google Fonts'u kaldırıp Arena'yı çevrim içi bir "isteğe bağlı" özellik olarak işaretlemek.
- Oyuncular arası iletilenler: takma ad, seçili kostüm, sohbet metni (kullanıcıdan kullanıcıya).
- Şifreleme / silme: veri yalnızca cihazda; silme = uygulamayı kaldırmak. Hesap yok → hesap silme gereği yok.
- Reklam: **yok** ("Uygulama reklam içermiyor"). Hedef kitle: bkz. §6 (çocuk politikası).

**Apple · App Privacy**
- Toplanan veri: yok (geliştirici toplamıyor); takip: yok → ATT gerekmez. Üçüncü taraf servisler IP görüyor: Apple "toplama" tanımını (sunucuya gönderip geliştirici / ortakların erişimi) tekrar değerlendirin.
- `PrivacyInfo.xcprivacy`: `NSPrivacyTracking = false`, toplanan veri tipleri boş; kullanılan API kategorileri için (Capacitor / WebView `UserDefaults`, dosya zaman damgası vb.) neden kodlarını Xcode raporuna göre ekleyin.
- Şifreleme: yalnızca standart HTTPS / WebRTC (DTLS); `ITSAppUsesNonExemptEncryption = NO` ve gerekirse muafiyet beyanı (doğrulayın).

---

## 6. Yaş derecelendirmesi, hedef kitle, mağaza varlıkları

### 6.1 Yaş derecelendirmesi (tahmin)
- İçerik: çizgi film / fantezi şiddeti, hafif: Yeti kovalıyor, top patlıyor / eriyor, küçük yaratıkları ezmek (MACERA / RUSH), ÇIĞ'da araç ve kasaba yutmak. Kan, silah, cinsellik, kumar, uyuşturucu, küfür (oyun metninde) yok.
- Beklenen sonuç (IARC / Apple anketi cevaplarına göre değişir): PEGI 7 civarı, ESRB E10+, Apple 9+; **sohbet** nedeniyle "kullanıcılar etkileşir / çevrim içi sohbet" işareti ve Apple'ın yeni anketinde mesajlaşma sorusu yaş sınırını yükseltebilir.
- Rastgele ödül (çark, sürpriz kutu) tamamen ücretsiz; gerçek parayla satılırsa "loot box" kuralları (olasılık açıklama) devreye girer.

### 6.2 Hedef kitle
- Çizgi film görünümü çocukları çeker. Play "Families" politikası, çocuklara yönelik uygulamada onaylı SDK'lar ve yabancılarla sohbetin kapalı olmasını ister (Trystero / PeerJS onaylı SDK değil).
- En temiz yol: hedef kitleyi 13+ seç **ve** Arena çevrim içi bölümünü çocuklara kapalı tut / B5'i uygula. Karar sahibe ait.

### 6.3 Mağaza varlıkları

**Google Play**
- Uygulama ikonu 512×512 PNG (32 bit, ≤1 MB).
- Öne çıkan görsel (feature graphic) 1024×500 JPG / PNG, alfa yok.
- Telefon ekran görüntüleri: en az 2, en çok 8; 9:16 (veya 16:9), kenarlar 320-3840 px; önerilen ≥1080 px dikey. Tablet 7"/10" görüntüleri isteğe bağlı (önerilir).
- Başlık ≤30, kısa açıklama ≤80, uzun açıklama ≤4000 karakter. Kategori: Oyunlar > Arcade (veya Casual). Gizlilik politikası URL'i, içerik derecelendirmesi (IARC), hedef kitle, reklam beyanı, Data safety.

**App Store**
- İkon 1024×1024 PNG (alfa yok, köşe yuvarlama yok).
- iPhone 6.9" ekran görüntüsü (1320×2868) zorunlu; 6.5" yedek (1284×2778 / 1242×2688). iPad destekleniyorsa 13" (2064×2752) gerekir: ya iPad desteğini kapatın ya görsel üretin.
- Ad ≤30, alt başlık ≤30, tanıtım metni ≤170, açıklama ≤4000, anahtar kelimeler ≤100 karakter. Destek URL'i ve gizlilik politikası URL'i zorunlu; telif hakkı satırı; inceleme notu.

(Ölçüler 2025-26 bilgime göre; Console'da güncel gereksinimleri doğrulayın.)

**Önerilen 6-8 ekran görüntüsü:** (1) Rush koşusu: engel + kombo, (2) kavşakta dönüş, (3) 500 m kutlaması / kombo seviye atlaması, (4) YENİ REKOR sonuç ekranı, (5) Kostüm dolabı, (6) BUGÜN merkezi (seri + sezon), (7) MACERA haritası, (8) KARTOPU ARENA. Her birine kısa TR + EN başlık.

### 6.4 Metin taslağı (karakter sayıları doğrulandı)

| Alan | TR | EN |
|---|---|---|
| Başlık (≤30) | `PATPAT: Kartopu & Yeti Kaçışı` (29) | `PATPAT: Snowball Yeti Run` (25) |
| Kısa açıklama (≤80) | `Kartopu ol, büyü, Yeti'den kaç! Tek parmakla oynanan dikey kar koşusu.` (70) | `Grow your snowball, outrun the Yeti! A one-finger vertical snow runner.` (71) |
| Apple alt başlık (≤30) | `Kartopu, Yeti ve çığ koşusu` (27) | `Snowball, Yeti & Avalanche` (26) |
| Apple anahtar kelimeler (≤100) | `kartopu,yeti,koşu,sonsuz,runner,kar,çığ,arcade,tek parmak,snowball,avalanche,eğlenceli` (86) | `snowball,yeti,runner,endless,avalanche,snow,arcade,one finger,casual,roll,smash,turkish` (87) |
| Tanıtım metni (≤170) | `Her gün yeni görev, seri ve sezon ödülleri seni bekliyor. Kartopunu büyüt, Yeti'yi atlat, rekoru kır!` (101) | — |

Uzun açıklama için iskelet: ne yapılır (tek parmak: kaydır, zıpla, eğil, kavşakta dön) → toplananlar (boyut = can, kar topla, yaratık ez) → modlar (YETİ RUSH sonsuz, MACERA 100 bölüm, ÇIĞ, KARTOPU ARENA) → bağlılık (günlük görev, seri, sezon, 35 top / 12 iz, başarımlar) → "Reklamsız, hesap yok, çevrimdışı oynanır" (Arena çevrim içi isteğe bağlı).

---

## 7. Hukuk ve lisanslar

- **3D modeller:** Kenney (CC0): Holiday, Platformer, Nature, City (Suburban), Car kitleri. Değiştirilmiş (birleştirilmiş, yeniden renklendirilmiş), CC0 buna izin veriyor. Kredi: `public/models/CREDITS.txt`, Ayarlar.
- **Ses efektleri:** Kenney (Impact / Interface / Music Jingles) ve rubberduck "sfx_breaking_and_falling" (OpenGameArt): CC0. `public/sfx/CREDITS.txt`.
- **Müzik:** prosedürel (kod ile üretiliyor); `public/` içinde başka medya yok.
- **Kütüphaneler (MIT):** three, @capacitor/*, peerjs, trystero → bildirim ekranı eksik (S4). vite yalnızca geliştirme aracı.
- **Yazı tipi:** Lilita One (SIL OFL), Google Fonts'tan yükleniyor (S1).
- **İsim çakışması riski:** "PatPat" adıyla mağazalarda başka uygulamalar / markalar olabilir (ör. aynı adla bir çocuk giyim alışveriş uygulaması hatırlıyorum, doğrulayın). Marka / mağaza araması yapın; gerekirse alt başlıkla ayırt edin ("PATPAT: Kartopu & Yeti Kaçışı").
- Politika ve beyanlarda yazan iletişim bilgisi sahibin gerçek adı / e-postası olmalı (şu an yer tutucu).

---

## 8. Performans, kararlılık, erişilebilirlik, yerelleştirme

**Performans.** Hedef orta seviye telefon: gölge haritası yok, tek ucuz son-işlem geçişi, runner bütçesi ≤25 draw call / ≤80k üçgen (`src/runner/biomes.js`). Kodda `renderer.setPixelRatio(dpr)` ile çözünürlük sınırlanıyor, `webglcontextlost` duraklatıyor. Eksik: gerçek cihaz kare süresi / ısınma / pil ölçümü. Öneri: 2 düşük (2 GB), 2 orta, 1 üst Android + 1 iPhone üzerinde 10 dakikalık koşu; hedef ≥50 FPS ortalama, 1 saatlik oturumda ısınma kaynaklı düşüş yok.

**Kararlılık.** Çökme raporlama yok (S2). Mağaza konsolları yalnızca yerel çökme / ANR'ı gösterir. Arka plana alma / geri tuşu / bellek baskısı senaryoları B6'da denenmeli.

**Erişilebilirlik.** Var: ses / müzik / titreşim anahtarları, tek elle oynanabilirlik, kenar çizgili yüksek kontrastlı metin, `aria-label`'lı düğmeler, `prefers-reduced-motion` desteği (HUD, sonuç ekranı ve menüler). Eksik / dikkat: 9-12 px yazılar, yakınlaştırma kapalı (`zoomEnabled: false`), renk körü için kırmızı-yeşil uyarılar, oyun alanı ekran okuyucuya kapalı (canvas; beklenen). Android'in "animasyonları kaldır" ayarının WebView'de `prefers-reduced-motion`'a yansıdığını cihazda doğrulayın.

**Yerelleştirme.** TR varsayılan, EN çeviri sözlükleri (`src/i18n/en_menus.js`, `en_ui.js`, `en_runner.js`, `en_agar.js`) ile; sistem dili Türkçe değilse EN açılır. Mağaza kayıtları TR + EN yazılmalı.

---

## 9. Önerilen sıra (takvim)

| Gün | İş |
|---|---|
| 0 | B9 (Play hesabı + kapalı test başlat) paralel; B1 (log), B3 (sürüm / imza iskeleti), B4 (politika yayını + iletişim) |
| 1-2 | B2 (ikon + açılış), B5 (serbest sohbeti kapat ya da moderasyon), S1 (yazı tipini göm), S3 (paylaşım düzeltmeleri) |
| 3-4 | B6 (cihaz testleri) + bulunan hataların düzeltilmesi, S2 (hata yakalama), S4 (lisans ekranı) |
| 4-5 | B7 (ekran görüntüleri + metin), form cevapları (§5, §6), Play iç test → kapalı test |
| +14 gün | Kişisel Play hesabıysa kapalı test süresi dolar → üretim |
| iOS (ayrı hat) | B8: Mac'te `cap add ios`, imza, TestFlight, App Store gönderimi (~3-5 gün + inceleme) |

---

## 10. Bu dalda yapılanlar ve yapılmayanlar

**Yapıldı**
- `public/privacy.html` (TR + EN) ve `PRIVACY.md`: kodla doğrulanmış gizlilik politikası; Ayarlar > "Gizlilik Politikası" bağlantısı (`src/menus.js`).
- Paylaşım bağlantısı: `src/sharecard.js` `shareUrl()` / `PUBLIC_URL` (native uygulamada `https://localhost` yerine herkese açık adres). Alan adı değişirse tek yerden güncellenir.
- Çentik / kesik: Rush üst ince çubukları artık güvenli alan altında (`--sat`); `#rcol`, `.char-intro.badge`, `#cig-introchip` ham `env()` yerine `--sat` kullanıyor.
- HUD: sayaç tikleri, 500 m kutlaması, çarpan ve kombo kademe animasyonları, `prefers-reduced-motion`.
- Sonuç ekranı: yeni rekor türleri (mesafe / skor / çift), önceki rekora göre fark, SEVİYE ve SEZON ilerleme çubukları, TEKRAR altında hedef satırı.
- Ana ekran: BUGÜN düğmesinde seri ve sezon ilerlemesi, günlük özet satırında seri.
- `public/favicon.svg` ve `index.html` açıklama / ikon satırı.

**Yapılmadı (dosya sahipliği veya onay gerektirdiği için)**
- `capacitor.config.json` `loggingBehavior` (B1), Android ikon / splash / imzalama / sürüm (B2, B3), `ios/` (B8).
- `src/agar/agar.js` sohbet ve ilk kullanım bilgilendirmesi (B5), `src/agar/invite.js` bağlantı düzeltmesi (S3).
- Yazı tipini indirip gömmek (S1): dosya indirme ve lisans ekleme onayı gerekir.
- `MOBILE.md` güncellemesi (S8).
- Gerçek cihaz testleri (B6) ve mağaza görselleri (B7).
