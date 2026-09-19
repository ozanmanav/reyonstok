-- Geliştirme ve gösterim için örnek ürünler.
--
-- Bu dosya `supabase db push --include-seed` ile uygulanır. Kod alanı üzerinden
-- upsert yaptığı için birden fazla kez çalıştırılabilir; mevcut kayıtların
-- stok ve fiyatını başlangıç değerlerine döndürür.
--
-- Barkodlar gerçek EAN-13 kontrol hanesi taşır, böylece tarama akışı elle
-- doğrulanabilir.

insert into public.products (
  code, barcode, name, category, shelf_location,
  cost_price, sale_price, stock_quantity, min_stock_alert, unit, notes
)
values
  ('ENV-1001', '8690000000012', 'Klasik Çekiç 500g', 'El Aletleri', 'Reyon A - Raf 1',
   180.00, 290.00, 14, 4, 'Adet', 'Ahşap saplı dayanıklı çekiç'),

  ('ENV-1002', '8690000000029', 'Şerit Metre 5m x 19mm', 'El Aletleri', 'Reyon A - Raf 1',
   65.00, 110.00, 2, 5, 'Adet', 'Otomatik kilitli'),

  ('ENV-1003', '8690000000036', 'Akrilik Mastik Beyaz 310ml', 'Yapıştırıcı ve Kimyasal', 'Reyon A - Raf 2',
   45.00, 75.00, 32, 10, 'Adet', 'İç ve dış cephe uyumlu'),

  ('ENV-1004', '8690000000043', 'Yıldız Tornavida No:2 150mm', 'El Aletleri', 'Reyon A - Raf 3',
   50.00, 85.00, 0, 3, 'Adet', 'Manyetik uçlu'),

  ('ENV-1005', '8690000000050', 'Elektrik Bandı Siyah 10m', 'Elektrik', 'Reyon B - Raf 1',
   12.00, 25.00, 45, 15, 'Adet', 'TSE onaylı yanmaz bant'),

  ('ENV-1006', '8690000000067', 'LED Ampul 9W Beyaz Işık E27', 'Elektrik', 'Reyon B - Raf 2',
   35.00, 60.00, 18, 6, 'Adet', 'Enerji tasarruflu'),

  ('ENV-1007', '8690000000074', 'Çelik Dübel 8x80 (50 Adet)', 'Bağlantı Elemanları', 'Reyon C - Raf 1',
   90.00, 150.00, 8, 3, 'Kutu', 'Ağır yük dübeli'),

  ('ENV-1008', '8690000000081', 'Sunta Vidası 4x50 (200 Adet)', 'Bağlantı Elemanları', 'Reyon C - Raf 2',
   120.00, 195.00, 3, 5, 'Kutu', 'Sarı çinko kaplama'),

  ('ENV-1009', null, 'Silikon Tabancası Orta Boy', 'El Aletleri', 'Reyon A - Raf 2',
   95.00, 160.00, 6, 2, 'Adet', 'Barkodu olmayan ürün örneği'),

  ('ENV-1010', '8690000000104', 'Maskeleme Bandı 48mm x 40m', 'Boya Malzemeleri', 'Reyon D - Raf 1',
   28.00, 55.00, 24, 8, 'Adet', 'Kolay sökülür')
on conflict (code) do update
set
  barcode = excluded.barcode,
  name = excluded.name,
  category = excluded.category,
  shelf_location = excluded.shelf_location,
  cost_price = excluded.cost_price,
  sale_price = excluded.sale_price,
  stock_quantity = excluded.stock_quantity,
  min_stock_alert = excluded.min_stock_alert,
  unit = excluded.unit,
  notes = excluded.notes;
