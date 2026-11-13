# PATPAT v3 — "Her modun bir amacı olsun" planı

Tarih: 12 Kasım 2026 · Yazan: yönetmen (Fable). Bu belge bağlayıcıdır; ajanlar plan yazmaz, bunu uygular.
Sahibin isteği: sonsuz mod kalsın (Temple Run gibi), bölüm bölüm mod olsun, ÇIĞ "amaçsız" duruyor: amaç ve zevk ver; tutan mağaza oyunlarından ders al; viral hiper-casual ol ama yetenek ve skor kasma kalsın.

## 0. Teşhis

Oyunda sistem çok, amaç az görünüyor. Görev seti, çarpan, sezon, pasaport, harf avı, 100 bölüm, 40 dağ var; ama oyuncu ekrana bakınca "şimdi ne için oynuyorum?" sorusunun tek cevabını göremiyor. Tutan oyunlar bunun tersini yapar: az sistem gösterir, her an tek bir hedef gösterir.

## 1. Tutan oyunlardan alınan dersler

| Oyun | Neden tutuyor | PATPAT'a uyarlaması |
|---|---|---|
| Subway Surfers | 3 görevlik set biter, kalıcı çarpan +1. Skor kasmanın yolu görev yapmaktır. Günlük kelime avı, haftalık av. | Görev seti ve çarpan zaten var: Rush'ın TEK omurgası yap, koşu başında ve sonuçta hep göster. |
| Temple Run 2 | Tek dokunuşla başlar, 1 sn'de tekrar. Hedefler seviye atlatır, seviye çarpan verir. | İlk koşularda seçim ekranı yok. Ölüm → tekrar 1 sn. |
| Hole.io | 2 dakikalık süre, "şehrin %kaçını yedin" tek sayı, büyüme gözle görülür, final patlaması. | ÇIĞ'ın amacı: dağın dibindeki KASABAYI YIK. Tek sayı: yıkım yüzdesi. |
| Katamari | Hedef boy baştan söylenir ("10 m ol"), ilerleme çubuğu hep ekranda, sonunda yıldıza dönüşür. | Her dağın başında hedef boy kartı, koşu boyunca "hedefe X m" çubuğu. |
| Candy Crush | Yol haritası: sıradaki bölüm hep görünür, yıldızlar, bölüm başına tek net hedef. | MACERA haritası menüde ikinci büyük buton; her bölümde tek cümlelik hedef. |
| Hill Climb Racing | Paranın anlamı var: kalıcı yükseltme, her koşu bir öncekinden biraz ileri gider. | ❄️ ile kalıcı yükseltmeler (başlangıç boyu, mıknatıs, erime direnci) görünür ve ilk oturumda alınabilir. |
| Crossy Road | Koleksiyon: yeni karakter açma isteği, hediye sayacı. | Skin koleksiyonu "N/38" olarak görünür; her act ve her 5 dağ bir skin verir. |
| Stumble Guys / Going Balls | Kısa bölüm, hemen sonraki, bonus bölümler. | Bölüm bitince tek tuş SONRAKİ; her 5 bölümde bonus/boss. |

## 2. Üç sütun: her modun tek cümlelik amacı

| Mod | Menüdeki adı | Amaç (oyuncunun ağzından) | Tek sayı |
|---|---|---|---|
| Sonsuz | OYNA · YETİ KAÇIŞI | "Rekorumu kıracağım, çarpanımı büyüteceğim." | Skor (mesafe × çarpan) |
| Bölümler | MACERA | "Sıradaki bölümü geçip haritada ilerleyeceğim, 3 yıldız yapacağım." | Bölüm no + yıldız |
| ÇIĞ | ÇIĞ · KASABA AVI | "Büyüyüp dağın dibindeki kasabayı yerle bir edeceğim." | Yıkım yüzdesi |

Arena yan mod olarak kalır; bu planın kapsamı dışında.

## 3. SONSUZ (Yeti Kaçışı) — kapatılmıyor, omurgası netleşiyor

- **Kalır:** sonsuz koşu, 3 şerit, boyut = can, Yeti, kavşaklar, biyomlar, kombo, kıl payı. Yetenek tavanı düşürülmez.
- **Amaç zinciri (her zaman ekranda bir tanesi):** sıradaki görev → set bitince çarpan +1 → çarpan skoru büyütür → rekor.
  - Koşu başında 2 sn: "GÖREV: 3 yaratık ez (1/3) · ÇARPAN x4".
  - Koşu içinde: tek hedef şeridi (görev ilerlemesi, yoksa "REKORA n m").
  - Sonuçta: tek büyük skor, rekor farkı, biten görev, "set için 1 görev kaldı".
- **Mesafe kilometre taşları dünya gezisine dönüşür:** her biyoma ilk girişte kartpostal (koleksiyon N/14). "Bugün Volkan'ı görebilecek miyim?" hedefi doğar.
- **Hiper-casual kabuk:** ilk 3 koşuda perk seçimi, haftalık mod çipi, kart kapısı yok; hepsi koşu sayısıyla açılır ve açılırken tek cümleyle tanıtılır.
- **Skor:** pasif oyuncuya da büyüyen sayı; usta oyuncu aynı mesafede 2-3 kat skor yapar (kıl payı, temiz kat, akış). Bu oran simde ölçülür.

## 4. BÖLÜMLER (MACERA) — "bölüm bölüm mod"

- 10 act × 10 bölüm zaten var (campaign.js). Eksik olan görünürlük ve netlik.
- **Menü:** OYNA'nın altında ikinci büyük buton: "MACERA · Bölüm 14 · ⭐ 31/300". Tek dokunuş sıradaki bölümü açar.
- **Bölüm kartı:** tek cümle hedef + 3 yıldız şartı. Bölüm tipleri isimle ayrışır: BİTİR, TOPLA (N kar tanesi), DOKUNULMAZ (çarpmadan), KAÇIŞ (Yeti hızlı), PATRON (act sonu).
- **Bölüm içi:** üstte bitişe kalan mesafe çubuğu + 3 yıldız pipi (canlı).
- **Bitiş:** yıldızlar tek tek açılır, tek tuş SONRAKİ BÖLÜM. Başarısızlıkta "az kaldı: %87" ve TEKRAR.
- **Act ödülü:** her act sonu boss + sandık + o act'e özel skin. Yıldız kapısı: sonraki act için toplam yıldız eşiği düşük tutulur (takılma yok), 3 yıldız koleksiyoncular içindir.

## 5. ÇIĞ — amaç: KASABAYI YIK

Bugün: etap kapıları (boy şartı) + final kapısı/duvarı/boss. Oyuncu neden büyüdüğünü hissetmiyor.

- **Kurgu:** her dağın dibinde adı olan bir KASABA var (dağın adıyla eş: "Altın Vadi Kasabası"). Final kapısı kalır ama kapıdan sonra kasabaya dalınır: 6-10 sn'lik yıkım finali (evler, kule, arabalar yutulur/parçalanır).
- **Baştan söylenen hedef:** giriş kartı ve koşu başı kamera bakışı: "KASABAYI YIK · en az 40 m ol". Hedef boy = final kapısı boyu (mevcut `finale.minR`).
- **Koşu içi tek gösterge:** "⚪ 12 m → 🏘️ 40 m" ilerleme çubuğu. Etap kapıları ara hedef olarak aynı çubukta çentik.
- **Tek sayı ve yıldızlar:** yıkım yüzdesi. 1⭐ kasabaya ulaş, 2⭐ %70 yıkım (mevcut "bitişte boy" yıldızının yerine geçer; boy büyükse yıkım da büyük olur), 3⭐ mevcut özel hedef (altın kasalar, süre, zincir…).
- **Kalıcı anlam:** dağ listesinde yıkılan kasabalar bayrakla işaretlenir, "FETHEDİLEN: 12/40". Her 5 kasaba = skin veya kalıcı yükseltme puanı.
- **ÇIĞ SONSUZ:** amaç kademe merdiveni: Kartopu → Çığ → Mega Çığ → Felaket → Kıyamet → Şehir Yutucu → Dağ Devi → GEZEGEN. HUD'da "sıradaki kademe: X ton". Rekor = en yüksek kademe + ton.
- **Kaybetme:** erime ve arkadan gelen çığ baskısı kalır; "kaybetmek imkânsız" olmasın (v2 teşhisi).

## 6. Ortak: paranın ve koleksiyonun anlamı

- ❄️ ilk oturumda bir şey aldırır (ilk kalıcı yükseltme ucuz).
- Koleksiyon sayaçları menüde: skin N/38, kartpostal N/14, kasaba N/40, yıldız N/300.
- Menüde tek "SIRADAKİ HEDEF" satırı üç sütundan en yakın olanı gösterir.

## 7. Uygulama (Astra usulü şeritler)

Kurallar: yapıcılar Sonnet ve tarayıcısız (sim + `npm run check` + build). Tarayıcı testi dalga sonunda TEK Haiku QA ajanında: headless, GPU (`--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist`), sessiz, küçük viewport, tek sekme, en çok 5 dk, `?net=local`. Puan kareye dayanır; yalnız sime dayanan puan 5'i geçemez. Kapı kırmızıyken şerit inmez. Ajan commit etmez.

| Şerit | Dosyalar | İş (bu planın bölümü) |
|---|---|---|
| rush | src/runner/* | §3 amaç zinciri, biyom kartpostal olayı, kademeli açılım |
| cig | cigplus.js, cigplan.js, world.js, props.js, main.js, ui.js | §5 kasaba finali, hedef çubuğu, yıkım yüzdesi, sonsuz kademe merdiveni |
| campaign | campaign.js (+ runner bölüm kancaları rush şeridiyle sözleşmeli) | §4 bölüm tipleri, canlı yıldız pipleri |
| menus | menus.js, meta.js, shop.js, save.js, style.css | §4 MACERA butonu, §6 sayaçlar ve SIRADAKİ HEDEF, fetih bayrakları, ödüller |
| visual | skins.js, fx.js, biomes.js, props (kasaba yıkım efekti cig ile sözleşmeli) | kasaba yıkım efektleri, act skinleri |
| QA | scripts/smoke-e2e.mjs | her sütun için 1 dk'lık kare seti, eleştirmen puanı |

Kabul ölçütü (eleştirmen karelerden puanlar, hedef ≥ 7): her modun ilk karesinde amaç okunuyor mu; koşu içinde tek hedef göstergesi var mı; bitiş ekranı "bir daha" dedirtiyor mu.

## 8. Hybrid-casual katmanı (4. tur; 3. tur şeritleri bunu UYGULAMAZ)

Sahibin isteği (13 Kasım 2026): "oyunu hybrid casual yap". Tanım: çekirdek hiper-casual kalır (tek parmak, 3 saniyede anlaşılır, anında tekrar); üstüne orta-çekirdek bir meta biner (kalıcı güçlenme, koleksiyon, seviye, etkinlik) ve gelir modeli karma olur (ödüllü reklam + küçük satın almalar).

Elimizdekiler dağınık duruyor: güç yükseltmeleri (`UPGRADES`), oyuncu XP/seviyesi, pasif yetenekli KARAKTER topları, görev seti → çarpan, sezon, pasaport, sandık, çark, günlük ödül. Yeni sistem eklenmez; bunlar TEK döngüye bağlanır.

### 8.1 Tek döngü
Koş → ❄️ + XP kazan → GÜÇLEN (yükseltme al, karakter aç) → daha uzağa git / daha çok yık → yeni içerik açılır (biyom, act, dağ, karakter) → koş.
Her koşudan sonra oyuncu "bir şey ilerledi" görmeli: XP çubuğu, bir yükseltmeye kalan ❄️, bir görev.

### 8.2 Güçlenme (Hill Climb / Archero dersi)
- Tek ekran: GÜÇ. Üç dal, her biri 5-6 kademe, fiyatlar ilk oturumda 1, üçüncü oturumda 3 alım yaptıracak eğride.
  - **Top:** başlangıç boyu, erime direnci, mıknatıs menzili.
  - **Güçler:** mevcut `UPGRADES` (mıknatıs, 2x skor, süper zıplama süreleri).
  - **Kazanç:** ❄️ çarpanı, XP çarpanı, sandık şansı.
- Güçlenme üç modda da hissedilir (Rush, Bölümler, ÇIĞ): başlangıç boyu ÇIĞ'da da, mıknatıs Rush'ta da çalışır.
- Yetenek tavanı korunur: yükseltmeler affeder ve hızlandırır, skoru oyuncunun yerine yapmaz. Skor tablosu hilesi olmasın diye çarpan katkısı sınırlıdır (güçten gelen skor payı en çok %25).

### 8.3 Karakterler (koleksiyon + oynanış)
- Her KARAKTER topunun bir pasif yeteneği var (zaten kodda). Bunu öne çıkar: dolapta yetenek kartı, koşu başında seçili karakterin rozeti.
- Karakter seviyesi (1-5): aynı karakterden kopya/parça toplandıkça yeteneği güçlenir. Parça kaynağı: sandık, act ödülü, kasaba fethi.
- Sıradan skinler kozmetik kalır.

### 8.4 Oyuncu seviyesi ve açılımlar
- XP tek kaynaktan: her koşu (mesafe/skor/yıldız/yıkım). Seviye atlayınca tek ekranlık ödül (❄️, parça, yeni özellik).
- Açılım haritası seviyeye bağlanır (bugün koşu sayısına bağlı `UNLOCKS`): Bölümler sv 2, ÇIĞ sv 3, Günlük sv 4, Arena sv 5, Sezon sv 6. Her açılım tek cümleyle tanıtılır.

### 8.5 Canlı içerik (zaten var, sadeleşir)
- Günlük: tek "BUGÜN" kartı (günün koşusu + günün dağı + günlük ödül).
- Haftalık mutatör ve sezon yolu tek SEZON ekranında.
- Etkinlik çapası: hafta sonu "2x ❄️" veya temalı kasaba.

### 8.6 Gelir (karar sahibinde; kod hazırlığı reklam SDK'sız yapılır)
- Ödüllü reklam noktaları (oyuncu isterse): BENİ KURTAR, koşu sonu 2x ❄️, bedava sandık, günlük çark ek çevirme. Zorla gösterilen reklam yok (ilk sürümde geçiş reklamı yok).
- Satın alma: reklamsız paket, başlangıç paketi, sezon bileti. Güç satılmaz (pay-to-win yok); zaman kısaltılır.
- Uygulama: `platform.rewarded(placement)` tek kapı. SDK bağlanana kadar kapı kapalıdır ve o butonlar görünmez; mevcut 💎/❄️ ile devam seçenekleri çalışır. AdMob/IAP eklenirse: UMP onayı, Data Safety ve gizlilik metni güncellenir (STORE_READINESS N6).

### 8.7 Şeritler (4. tur)
| Şerit | İş |
|---|---|
| menus/meta | GÜÇ ekranı (3 dal), XP/seviye ödül ekranı, seviyeye bağlı açılımlar, karakter seviyeleri, `platform.rewarded` kapısı |
| rush | Top dalı ve karakter seviyesi etkileri, güç payı sınırı (%25) simle doğrulanır |
| cig | Top dalının ÇIĞ'daki etkisi, kasaba fethinden parça ödülü |
| visual | karakter rozetleri, seviye atlama efekti |
| QA | koşu → ödül → GÜÇ alımı → sonraki koşu akışının kare seti; ekonomi simi (oturum 1-5) |

Kabul: yeni oyuncu 1. oturumda en az 1 yükseltme alır; 5. oturumda en az 6 alım + 1 karakter; usta/pasif skor oranı 2 katın altına düşmez.

## 9. Yeti Rush: ilerledikçe değişen bölümler (4. tur, rush şeridi)

Sahibin isteği (13 Kasım 2026): "daha farklı bölümler, ilerleyen içerikler ekle". Bugün sonsuz koşu her 600 m'de zorlaşıyor ve biyom değişiyor; ama oynanış aynı kalıyor. Hedef: her katman adı olan, kendi kuralı olan bir BÖLÜM olsun ve oyuncu "bugün hangisine kadar gideceğim?" desin.

### 9.1 Yapı
- Koşu bölümlere ayrılır: ~500-700 m, başında 1 sn'lik isim şeridi ("BÖLÜM 3 · BUZ TÜNELİ"), sonunda kapı ve ödül.
- Her bölümün bir imza kuralı vardır; engel dizileri o kurala göre seçilir. Bölüm sırası ilk 6 bölümde sabit (öğretir), sonra tohumlu karışık.
- Yeni bölüm tipleri oyuncunun en iyi mesafesi/seviyesiyle açılır; ilk girişte tek cümle tanıtım ve kartpostal.
- Mevcut parçalar yeniden kullanılır (TRACK_FEATURES.md ve campaign.js `FEATURE_INTRO`: kavşak, dalga, kayak atlayışı, uçurum, buz köprüsü, karşıdan gelenler, half-pipe, helix, tüp, ray, rüzgâr, halat, sis, loop). Yeni parça tipi yalnızca aşağıdakiler için yazılır.

### 9.2 Bölüm tipleri
| # | Bölüm | Kural | Açılır |
|---|---|---|---|
| 1 | Yamaç | temel şerit, zıpla, eğil | baştan |
| 2 | Orman Slalomu | sık ağaç kapıları, ritimli sağ-sol | baştan |
| 3 | Buz Tüneli | tüp içinde 360° yuvarlanma, tavandan sarkıt | 600 m |
| 4 | Ray Hattı | raylara bin, raydan raya atla, altta boşluk | 1.200 m |
| 5 | Çığ Kaçışı | arkadan çığ duvarı, engel az, hız çok, durmak yok | 1.800 m |
| 6 | Yeti Düellosu | Yeti öne geçer, kaya atar; kayaların üstünden zıpla, 3 kıl payı = Yeti sersemler, ödül | 2.400 m |
| 7 | Altın Damar | bonus bölüm: engel yok, kar tanesi yağmuru, 10 sn | her 4 bölümde bir |
| 8 | Sis Vadisi | görüş kısa, pist kenarı ışıkları yol gösterir | 3.000 m |
| 9 | Kayak Rampaları | art arda rampalar, havada numara (kaydır = takla, puan) | 3.600 m |
| 10 | Ters Rüzgâr | rüzgâr topu yana iter, şerit tutmak beceri ister | 4.200 m |
| 11 | Gece Koşusu | karanlık, yalnız fener konisi; toplananlar parlar | 5.000 m |
| 12 | Kızak Bölümü | kızağa bin: daha hızlı, geniş dönüş, engelleri kırar | 6.000 m |

### 9.3 Kurallar
- Her bölüm tek yeni fiil veya tek yeni baskı getirir; ikisi birden gelmez.
- Bölüm sonu ödülü: ❄️ + XP + (ilk geçişte) kartpostal. Bölüm rekoru: "en uzak: BÖLÜM 7".
- Yetenek: her bölümün bir ustalık hedefi var (hasarsız geç = TEMİZ BÖLÜM, 2x ödül).
- Simle doğrulama: her bölüm tipi geçilebilir (her satırda serbest rota), tohumlarda görünür, bot hayatta kalma eğrisi bozulmaz.
- Bütçe: bölüm başına yeni draw call yok; mevcut instanced havuzlar.
