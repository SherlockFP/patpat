// English dictionary: wardrobe v2 (shop.js, shopview.js, cosmetics.js, new skins / trails)
export const words = {
  // tabs, filters, collection, stage
  'HALKA': 'RINGS', 'EZME': 'STOMPS', 'AURA': 'AURAS', 'YETİ': 'YETI', 'ÖLÜM': 'DEATH', 'KUTLAMA': 'EMOTES',
  'HEPSİ': 'ALL', 'SENDE': 'OWNED', 'ALINABİLİR': 'AFFORDABLE', 'YENİ': 'NEW', 'DENE': 'TRY',
  'KOLEKSİYON': 'COLLECTION', 'Burada henüz bir şey yok.': 'Nothing here yet.',
  'GÜNÜN FIRSATI': "TODAY'S DEAL", 'SETLER': 'SETS', 'TAMAM ✓': 'DONE ✓',
  'İNDİRİM': 'OFF', 'SET İNDİRİMİ': 'SET DISCOUNT', 'parça': 'pieces', 'eski fiyat': 'was',
  'ALABİLİRSİN!': 'YOU CAN BUY IT!',
  // sets
  'Aşk Seti': 'Love Set', 'Buz Seti': 'Ice Set', 'Ateş Seti': 'Fire Set',
  // hop rings
  'Klasik Halka': 'Classic Ring', 'Çift Halka': 'Double Ring', 'Kesik Halka': 'Dashed Ring', 'Yıldız Halkası': 'Star Ring', 'Kalp Halkası': 'Heart Ring', 'Elmas Halka': 'Diamond Ring', 'Çiçek Halkası': 'Flower Ring',
  // stomps
  'Klasik Ezme': 'Classic Stomp', 'Kar Patlaması': 'Snow Burst', 'Buz Kırığı': 'Ice Shards', 'Kalp Patlaması': 'Heart Burst', 'Konfeti Patlaması': 'Confetti Burst', 'Altın Yağmuru': 'Gold Rain', 'Havai Fişek': 'Fireworks', 'Lav Fışkırması': 'Lava Spurt',
  // blasts
  'Altın Alev': 'Golden Flame', 'Kızıl Alev': 'Red Flame', 'Mavi Alev': 'Blue Flame', 'Buz Aurası': 'Ice Aura', 'Pembe Şimşek': 'Pink Lightning', 'Gökkuşağı Aura': 'Rainbow Aura', 'Hayalet Yeşili': 'Ghost Green',
  // yeti
  'Klasik Yeti': 'Classic Yeti', 'Pembe Yeti': 'Pink Yeti', 'Zombi Yeti': 'Zombie Yeti', 'Buz Yeti': 'Ice Yeti', 'Gece Yeti': 'Night Yeti', 'Lav Yeti': 'Lava Yeti', 'Robot Yeti': 'Robot Yeti', 'Altın Yeti': 'Golden Yeti',
  // death
  'Klasik': 'Classic', 'Duman Bulutu': 'Smoke Cloud', 'Konfeti Çöküşü': 'Confetti Collapse', 'Kalp Dağılması': 'Heart Shatter', 'Balon Patlaması': 'Balloon Pop', 'Yıldız Uçuşu': 'Starry Daze',
  // emotes
  'Sessiz': 'Silent', 'Selam': 'Salute', 'Dans': 'Dance', 'Kalp Atışı': 'Heartbeat', 'Zafer Zıplaması': 'Victory Jump', 'Roket': 'Rocket', 'Alev Dansı': 'Fire Dance', 'Taç Töreni': 'Crown Ceremony',
  // balls
  'Piksel Top': 'Pixel Ball', 'Patlamış Mısır': 'Popcorn', 'Peynir': 'Cheese', 'Ay Topu': 'Moon Ball', 'Mumya': 'Mummy', 'Kaplan': 'Tiger', 'Armadillo': 'Armadillo', 'Göz Küresi': 'Eyeball',
  'Sabun Köpüğü': 'Soap Bubble', 'Kristal Geod': 'Crystal Geode', 'Kar Küresi': 'Snow Globe', 'Hologram': 'Hologram', 'Magma': 'Magma', 'Yıldırım Küresi': 'Tesla Orb', 'Elmas Top': 'Diamond Ball',
  // trails
  'Duman İzi': 'Smoke Trail', 'Piksel İzi': 'Pixel Trail', 'Kıvılcım İzi': 'Spark Trail', 'Sonbahar Yaprakları': 'Autumn Leaves', 'Baloncuk İzi': 'Bubble Trail', 'Konfeti Yağmuru': 'Confetti Rain',
  'Nota İzi': 'Music Trail', 'Kalp Yağmuru': 'Heart Rain', 'Kuyruklu Yıldız': 'Comet', 'Şimşek Zinciri': 'Chain Lightning', 'Elmas Tozu': 'Diamond Dust', 'Ejder Nefesi': 'Dragon Breath',
  // renamed skins
  'Gizli ödül': 'Secret reward',
};
export const patterns = [
  [/^%(\d+) İNDİRİM · eski fiyat ❄️ ([\d.,]+)$/, '$1% OFF · was ❄️ $2'],
  [/^KOLEKSİYON (\d+)\/(\d+) · %(\d+)$/, 'COLLECTION $1/$2 · $3%'],
  [/^(\d+)\/(\d+) parça · %(\d+) SET İNDİRİMİ$/, '$1/$2 pieces · $3% SET DISCOUNT'],
  [/^⭐ VİTRİN -%15 · ⏳ (.+)$/, '⭐ SHOWCASE -15% · ⏳ $1'],
];
