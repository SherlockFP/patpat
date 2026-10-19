# PATPAT Gizlilik Politikası / Privacy Policy

Bu metin `public/privacy.html` ile aynıdır (oyunla birlikte paketlenir, GitHub Pages / Render üzerinden yayınlanır).
Mağaza formlarında istenen "gizlilik politikası URL'i" olarak yayındaki `privacy.html` adresi kullanılır.
Oyundaki Ayarlar > "Gizlilik Politikası" bağlantısı da aynı sayfayı açar (adres: `src/sharecard.js` içindeki `PUBLIC_URL`).

*This text is identical to `public/privacy.html`. Use the published `privacy.html` URL as the "privacy policy URL" in the store forms.*

---

## Türkçe

**Son güncelleme:** 19 Ekim 2026 · **Oyun sürümü:** 0.3.x

### Kısaca

- Hesap, e-posta, telefon, konum, rehber, kamera veya mikrofon istemiyoruz.
- Reklam, analitik, çökme raporlama, çerez ve takip yok. Oyun içi satın alma yok.
- İlerlemen (rekorlar, kostümler, görevler, ayarlar) yalnızca cihazında saklanır. Kendi sunucumuz yok; kişisel veri toplamıyor, satmıyor, paylaşmıyoruz.
- İnternet yalnızca iki durumda kullanılır: menü yazı tipi (Google Fonts) ve KARTOPU ARENA'nın çevrim içi odaları. Ayrıntılar aşağıda.

### 1. Cihazında saklanan veriler

Oyun verileri uygulamanın yerel depolama alanında (`localStorage`) tutar: ❄️ kar tanesi ve 💎 kristal sayıları, açtığın kostümler ve izler, rekorlar ve bölüm yıldızları, görev / başarım / günlük seri / sezon ilerlemesi, ayarlar (dil, ses, müzik, titreşim, görünüm), Arena takma adın ve Arena rekorların, öğretici ve ilk kullanım işaretleri, bildirim izninin sorulup sorulmadığı.

Bu veriler cihazından dışarı gönderilmez. Uygulamayı kaldırdığında (web sürümünde tarayıcının site verilerini temizlediğinde) silinir. Android'in otomatik yedekleme özelliği açıksa işletim sistemi bu verileri senin Google hesabına yedekleyebilir; bu bizim kontrolümüzde değildir.

### 2. İnternete bağlanılan durumlar

**a) Menü yazı tipi.** Menü başlıkları için "Lilita One" yazı tipi, internet varsa Google Fonts'tan (`fonts.googleapis.com`, `fonts.gstatic.com`) yüklenir. Bu istekte IP adresin ve tarayıcı / cihaz bilgin Google'a ulaşır; Google'ın kendi gizlilik politikası geçerlidir. İnternet yoksa sistem yazı tipi kullanılır ve oyun aynen çalışır.

**b) KARTOPU ARENA çevrim içi odalar.** Yalnızca Arena'da "HIZLI OYNA", "AÇIK ODALAR", "ODA KUR" veya "KODLA KATIL" seçeneklerini kullanırsan. "TEK OYUNCU" ve diğer tüm modlar (YETİ RUSH, MACERA, ÇIĞ, GÜNÜN DAĞI) internet kullanmaz.

- **Oda keşfi** ("HIZLI OYNA", "AÇIK ODALAR" ve herkese açık oda): herkese açık üçüncü taraf Nostr röle sunucularına (Trystero kütüphanesi) WebSocket bağlantısı ve WebRTC için bir STUN sunucusu (Cloudflare) kullanılır. Herkese açık bir oda kurarsan oda kodu, oda adı, takma adın, oyuncu sayısı ve harita bilgisi bu kanaldan diğer oyunculara duyurulur. "Özel oda" ve "KODLA KATIL" bu kanalı kullanmaz.
- **Oyun bağlantısı** (tüm çevrim içi odalar): eşleştirme için PeerJS Cloud sunucusu (`0.peerjs.com`), ağ geçişi için STUN / TURN sunucuları (Google STUN, PeerJS TURN) kullanılır; oyuncular birbirine doğrudan (WebRTC) bağlanır. WebRTC'nin doğası gereği aynı odadaki oyuncular ve bu üçüncü taraf sunucular IP adresini görebilir.
- **Odadaki oyunculara giden veriler:** takma adın (en fazla 12 karakter, kendin yazarsın), seçili top ve iz kostümün, oyun hareketlerin ve yazdığın sohbet mesajları (en fazla 80 karakter; basit bir küfür filtresi vardır ama sohbet denetlenmez).
- Bu verileri bizim sunucularımız toplamaz veya saklamaz, çünkü sunucumuz yok. Üçüncü tarafların kendi kayıtları ve politikaları geçerlidir.

**c) Paylaşım.** PAYLAŞ'a bastığında sonuç görseli cihazında üretilir ve işletim sisteminin paylaşım penceresine verilir (ya da indirilir / bağlantı panoya kopyalanır). Nereye göndereceğini sen seçersin; oyun görseli herhangi bir sunucuya yüklemez.

**d) Bildirimler.** Günlük hatırlatma bildirimleri cihazda yerel olarak planlanır; push sunucusu veya bildirim jetonu yoktur. İzni ilk koşulardan sonra bir kez sorarız; sistem ayarlarından istediğin zaman kapatabilirsin.

**e) Titreşim** yalnızca cihazın titreşim motorunu çalıştırır.

### 3. Toplamadıklarımız

Ad, e-posta, telefon, adres, konum, kişi listesi, fotoğraf / medya, mikrofon, kamera, reklam kimliği, cihaz kimliği ve ödeme bilgisi. Oyundaki olay sayacı (görev ve başarımları ilerleten iç kayıtlar) yalnızca cihazındaki yerel depolamayı günceller; hiçbir yere gönderilmez.

### 4. Çocuklar

PATPAT hiç kimseden kişisel veri toplamaz. Ancak çevrim içi Arena odalarında yabancılarla yazışmak mümkün olduğundan, ebeveynlerin küçük çocukların bu bölümü kullanmasını denetlemesini öneririz.

### 5. Haklar ve silme

Bizde saklanan kişisel veri olmadığı için erişim, düzeltme veya silme taleplerine konu olacak bir kaydımız yoktur. Cihazındaki verileri uygulamayı kaldırarak silebilirsin. Üçüncü tarafların (Google, Cloudflare, PeerJS, Nostr röleleri) tuttuğu kayıtlar için ilgili hizmetin politikasına bak.

### 6. Değişiklikler

Bu sayfa güncellenirse yukarıdaki tarih değişir. Reklam, satın alma, hesap veya analitik eklenirse bu politika ve mağaza beyanları yayından önce güncellenir.

### 7. İletişim

**[GELİŞTİRİCİ ADI]** · **[İLETİŞİM E-POSTASI]** *(yayından önce doldurulmalı)*

---

## English

**Last updated:** 19 October 2026 · **Game version:** 0.3.x

### In short

- No account, email, phone number, location, contacts, camera or microphone.
- No ads, analytics, crash reporting, cookies or tracking. No in-app purchases.
- Your progress (records, costumes, quests, settings) stays on your device only. We run no server; we do not collect, sell or share personal data.
- The internet is used in two cases only: the menu font (Google Fonts) and the online rooms of KARTOPU ARENA. Details below.

### 1. Data stored on your device

The game keeps its data in the app's local storage (`localStorage`): ❄️ snowflake and 💎 crystal counts, unlocked costumes and trails, records and level stars, quest / achievement / daily-streak / season progress, settings (language, sound, music, vibration, look), your Arena nickname and Arena records, tutorial and first-run flags, and whether the notification permission was asked.

This data is never sent off your device. It is deleted when you uninstall the app (on the web version: when you clear the browser's site data). If Android's automatic backup is on, the operating system may back this data up to your Google account; that is outside our control.

### 2. When the game connects to the internet

**a) Menu font.** For the menu headings, the "Lilita One" font is loaded from Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`) when you are online. That request lets Google see your IP address and browser / device information; Google's own privacy policy applies. Offline, a system font is used and the game works the same.

**b) KARTOPU ARENA online rooms.** Only if you use "QUICK PLAY" (HIZLI OYNA), "OPEN ROOMS" (AÇIK ODALAR), "CREATE ROOM" (ODA KUR) or "JOIN WITH CODE" (KODLA KATIL) in Arena. "SOLO" (TEK OYUNCU) and every other mode (YETI RUSH, ADVENTURE, AVALANCHE, TODAY'S MOUNTAIN) use no internet.

- **Room discovery** ("QUICK PLAY", "OPEN ROOMS" and public rooms): a WebSocket connection to public third-party Nostr relay servers (the Trystero library) and a STUN server (Cloudflare) for WebRTC. If you open a public room, its code, room name, your nickname, player count and map are announced to other players over this channel. A private room and "JOIN WITH CODE" do not use this channel.
- **Game connection** (all online rooms): the PeerJS Cloud server (`0.peerjs.com`) is used for matchmaking and STUN / TURN servers (Google STUN, PeerJS TURN) for network traversal; players connect to each other directly (WebRTC). By the nature of WebRTC, the other players in the room and these third-party servers can see your IP address.
- **Data sent to other players in the room:** your nickname (up to 12 characters, typed by you), your selected ball and trail costume, your in-game movements and the chat messages you type (up to 80 characters; a basic profanity filter exists but chat is not moderated).
- Our servers do not collect or store this data, because we have none. The third parties' own logs and policies apply.

**c) Sharing.** When you tap SHARE, the result image is generated on your device and handed to the operating system's share sheet (or downloaded / the link is copied to the clipboard). You choose where it goes; the game does not upload the image to any server.

**d) Notifications.** Daily reminder notifications are scheduled locally on the device; there is no push server or notification token. We ask for permission once after your first runs; you can turn it off in system settings at any time.

**e) Vibration** only drives the device's vibration motor.

### 3. What we do not collect

Name, email, phone, address, location, contacts, photos / media, microphone, camera, advertising ID, device ID and payment details. The game's internal event counter (the records that advance quests and achievements) only updates local storage on your device and is sent nowhere.

### 4. Children

PATPAT collects personal data from no one. Because players can chat with strangers in online Arena rooms, we recommend that parents supervise young children who use that part.

### 5. Your rights and deletion

We hold no personal data, so there is no record that could be the subject of an access, correction or deletion request. You can delete the data on your device by uninstalling the app. For records held by third parties (Google, Cloudflare, PeerJS, Nostr relays) see the relevant service's policy.

### 6. Changes

If this page changes, the date above changes. If ads, purchases, accounts or analytics are ever added, this policy and the store declarations will be updated before release.

### 7. Contact

**[DEVELOPER NAME]** · **[CONTACT EMAIL]** *(to be filled in before release)*
