'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createDetector, type ScannerDetector } from '@/lib/scanner/detector';
import { normalizeScan, type ScanResult } from '@/lib/scan-code';
import { playBeep, vibrate } from '@/lib/sound';

/**
 * Kamera ile karekod ve barkod okuyucu.
 *
 * Tasarım kararları:
 *
 *  - Kamera akışı üzerinde kare kare okuma yapılıyor. `requestVideoFrameCallback`
 *    varsa o kullanılıyor (yalnızca yeni kare geldiğinde çalışır, pil dostu);
 *    yoksa zamanlayıcıya düşülüyor.
 *  - Okuma isteği bir sonraki kareyi beklemeden sıraya alınmıyor: çözümleme
 *    kareden uzun sürerse işler birikip arayüz donardı.
 *  - Aynı kod kısa süre içinde tekrar okunduğunda yok sayılıyor; kamera aynı
 *    etikete bakarken saniyede onlarca kez aynı sonucu üretiyor.
 *  - Kamera açılamadığında elle kod yazma ve fotoğraf çekip okutma yedekleri
 *    kalıyor; mağazada kamera izni verilmemiş bir telefon işi durdurmamalı.
 */

interface BarcodeScannerProps {
  /** Geçerli bir kod okunduğunda çağrılır. */
  onScan: (result: ScanResult) => void;
  /** Okuma sonrası kamerayı durdurup sonucu göstermek için. */
  paused?: boolean;
}

type ScannerState = 'idle' | 'starting' | 'scanning' | 'error';

type ScannerErrorKind = 'insecure' | 'permission' | 'no-camera' | 'unknown';

/** Aynı kodun tekrar tekrar bildirilmesini engelleyen süre. */
const REPEAT_BLOCK_MS = 2500;

/** `requestVideoFrameCallback` yokken kareler arası bekleme. */
const FALLBACK_FRAME_MS = 120;

export default function BarcodeScanner({ onScan, paused = false }: BarcodeScannerProps) {
  const [state, setState] = useState<ScannerState>('idle');
  const [errorKind, setErrorKind] = useState<ScannerErrorKind | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [detectorSource, setDetectorSource] = useState<ScannerDetector['source'] | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<ScannerDetector | null>(null);
  const loopActiveRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCodeRef = useRef<{ code: string; at: number } | null>(null);

  /** Okunan değeri çözümleyip yinelenen okumaları süzerek yukarı bildirir. */
  const reportCode = useCallback(
    (raw: string) => {
      const result = normalizeScan(raw);
      if (result.code === '') {
        return;
      }

      const previous = lastCodeRef.current;
      const now = Date.now();
      if (previous && previous.code === result.code && now - previous.at < REPEAT_BLOCK_MS) {
        return;
      }

      lastCodeRef.current = { code: result.code, at: now };
      playBeep('success');
      vibrate();
      onScan(result);
    },
    [onScan]
  );

  /**
   * Kamera akışını ve okuma döngüsünü durdurur.
   *
   * Bilinçli olarak yalnızca dış kaynakları (kamera izleri, zamanlayıcı)
   * temizliyor; React durumuna dokunmuyor. Böylece effect içinden çağrılması
   * zincirleme render tetiklemiyor, görsel durum `paused` değerinden türetiliyor.
   */
  const stopCamera = useCallback(() => {
    loopActiveRef.current = false;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  /** Kullanıcı kamerayı kapattığında: kaynakları bırak ve arayüzü boşa al. */
  const handleStopCamera = useCallback(() => {
    stopCamera();
    setTorchOn(false);
    setTorchAvailable(false);
    setState('idle');
  }, [stopCamera]);

  /**
   * Kare okuma döngüsünü başlatır.
   *
   * Okuma ve sıraya alma aynı kapsamda tutuluyor: çözümleme bitmeden yeni kare
   * işlenmiyor, böylece yavaş cihazlarda işler birikip arayüz donmuyor.
   */
  const startLoop = useCallback(() => {
    const queueNextFrame = () => {
      if (!loopActiveRef.current) {
        return;
      }

      const video = videoRef.current;
      if (!video) {
        return;
      }

      // requestVideoFrameCallback yalnızca yeni kare hazır olduğunda çalışır;
      // boşa çözümleme yapmadığı için pil ömrüne iyi geliyor.
      const withFrameCallback = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (callback: () => void) => number;
      };

      if (typeof withFrameCallback.requestVideoFrameCallback === 'function') {
        withFrameCallback.requestVideoFrameCallback(() => void readFrame());
      } else {
        timeoutRef.current = setTimeout(() => void readFrame(), FALLBACK_FRAME_MS);
      }
    };

    const readFrame = async () => {
      if (!loopActiveRef.current) {
        return;
      }

      const video = videoRef.current;
      const detector = detectorRef.current;

      // readyState < 2: henüz çözümlenecek görüntü verisi yok.
      if (video && detector && video.readyState >= 2) {
        try {
          const codes = await detector.detect(video);
          if (codes.length > 0) {
            reportCode(codes[0].rawValue);
          }
        } catch {
          // Tek karede çözümleme hatası olağan (bulanık kare, geçici durum);
          // döngüyü kesmiyoruz.
        }
      }

      queueNextFrame();
    };

    queueNextFrame();
  }, [reportCode]);

  const startCamera = useCallback(async () => {
    // Güvenli bağlam olmadan (http) tarayıcılar kamerayı hiç vermiyor.
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setState('error');
      setErrorKind('insecure');
      setShowManual(true);

      return;
    }

    setState('starting');
    setErrorKind(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Reyon etiketi okunacağı için arka kamera.
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });

      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());

        return;
      }

      video.srcObject = stream;
      // iOS'ta tam ekrana geçmeden oynatmak için ikisi de gerekli.
      video.muted = true;
      video.playsInline = true;
      await video.play();

      const [track] = stream.getVideoTracks();
      const capabilities = track?.getCapabilities?.() as { torch?: boolean } | undefined;
      setTorchAvailable(Boolean(capabilities?.torch));

      detectorRef.current ??= await createDetector();
      setDetectorSource(detectorRef.current.source);

      setState('scanning');
      loopActiveRef.current = true;
      startLoop();
    } catch (error) {
      stopCamera();
      setState('error');
      setErrorKind(classifyCameraError(error));
      // Kamera yoksa personel elle devam edebilsin.
      setShowManual(true);
    }
  }, [startLoop, stopCamera]);

  // Bileşen ekrandayken kamerayı aç, duraklatıldığında veya ayrılırken kapat.
  //
  // Kamera başlatma bir sonraki tike bırakılıyor: `startCamera` durum
  // güncellemesiyle başlıyor ve bunu effect gövdesinde senkron çağırmak
  // zincirleme render tetikliyor. Kamera açılışı zaten eşzamansız olduğu için
  // bu gecikmenin kullanıcıya etkisi yok.
  useEffect(() => {
    if (paused) {
      stopCamera();

      return;
    }

    let cancelled = false;
    const startTimer = setTimeout(() => {
      if (!cancelled) {
        void startCamera();
      }
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      stopCamera();
    };
  }, [paused, startCamera, stopCamera]);

  // Duraklatıldığında kamera kapalı olduğu için tarama katmanı gösterilmemeli.
  const visualState: ScannerState = paused ? 'idle' : state;

  const toggleTorch = async () => {
    const [track] = streamRef.current?.getVideoTracks() ?? [];
    if (!track) {
      return;
    }

    try {
      const next = !torchOn;
      await track.applyConstraints({
        advanced: [{ torch: next } as unknown as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      // Fener desteklenmiyorsa butonu gizle.
      setTorchAvailable(false);
    }
  };

  const handleManualSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    const result = normalizeScan(manualCode);
    if (result.code === '') {
      setManualError('Geçerli bir kod veya barkod girin');

      return;
    }

    setManualError(null);
    setManualCode('');
    // Elle girişte yineleme engelini atlayalım: kullanıcı bilerek tekrar arıyor.
    lastCodeRef.current = null;
    reportCode(result.code);
  };

  /** Kamera akışı yoksa tek kare fotoğraf çekip onu okur. */
  const handlePhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    setPhotoBusy(true);
    setManualError(null);

    try {
      detectorRef.current ??= await createDetector();
      const codes = await detectorRef.current.detect(file);

      if (codes.length === 0) {
        playBeep('warning');
        setManualError('Fotoğrafta kod okunamadı, daha yakından ve net çekin');

        return;
      }

      lastCodeRef.current = null;
      reportCode(codes[0].rawValue);
    } catch {
      playBeep('warning');
      setManualError('Fotoğraf okunamadı, tekrar deneyin');
    } finally {
      setPhotoBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-3xl border-2 border-zinc-800 bg-zinc-950">
        <div className="relative aspect-square w-full">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            // Erişilebilirlik: canlı kamera görüntüsü dekoratif, bilgi metinle veriliyor.
            aria-hidden="true"
            muted
            playsInline
          />

          {visualState === 'scanning' ? <ScanOverlay /> : null}

          {visualState !== 'scanning' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-950 p-6 text-center">
              {visualState === 'starting' ? (
                <p className="text-sm font-bold text-zinc-200">Kamera açılıyor...</p>
              ) : (
                <>
                  <p className="text-sm font-bold text-white">
                    {errorKind ? errorMessages[errorKind].title : 'Kamera hazır değil'}
                  </p>
                  {errorKind ? (
                    <p className="max-w-xs text-xs leading-relaxed text-zinc-400">
                      {errorMessages[errorKind].detail}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void startCamera()}
                    className="rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-black text-zinc-950"
                  >
                    Kamerayı başlat
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-zinc-800 bg-zinc-900 px-3 py-2.5">
          <div className="flex items-center gap-2">
            {visualState === 'scanning' ? (
              <button
                type="button"
                onClick={handleStopCamera}
                className="rounded-xl bg-zinc-800 px-3 py-2 text-xs font-bold text-rose-300"
              >
                Kamerayı kapat
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void startCamera()}
                className="rounded-xl bg-zinc-800 px-3 py-2 text-xs font-bold text-emerald-300"
              >
                Yeniden başlat
              </button>
            )}

            {torchAvailable && visualState === 'scanning' ? (
              <button
                type="button"
                onClick={() => void toggleTorch()}
                aria-pressed={torchOn}
                className={`rounded-xl px-3 py-2 text-xs font-bold ${
                  torchOn ? 'bg-amber-400 text-zinc-950' : 'bg-zinc-800 text-zinc-300'
                }`}
              >
                Fener
              </button>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setShowManual((open) => !open)}
            className="text-xs font-semibold text-zinc-400"
            aria-expanded={showManual}
          >
            {showManual ? 'Elle girişi kapat' : 'Elle kod gir'}
          </button>
        </div>
      </div>

      {detectorSource === 'wasm' && visualState === 'scanning' ? (
        <p className="text-center text-[11px] text-zinc-500">
          Bu tarayıcıda yazılımsal okuyucu kullanılıyor; okuma biraz daha yavaş olabilir.
        </p>
      ) : null}

      {showManual ? (
        <div className="space-y-3 rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
          <form onSubmit={handleManualSubmit} className="space-y-2">
            <label htmlFor="manual-code" className="block text-sm font-semibold text-zinc-700">
              Ürün kodu veya barkod
            </label>
            <div className="flex gap-2">
              <input
                id="manual-code"
                value={manualCode}
                onChange={(event) => setManualCode(event.target.value)}
                placeholder="ENV-1001 veya 8690000000012"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                className="min-w-0 flex-1 rounded-xl border border-zinc-300 px-3 py-2.5 font-mono text-base text-zinc-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
              />
              <button
                type="submit"
                className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white"
              >
                Ara
              </button>
            </div>
          </form>

          <div className="flex items-center justify-between gap-2 border-t border-zinc-100 pt-3">
            <span className="text-xs text-zinc-500">Kamera açılmıyorsa fotoğraf çekin:</span>
            <label
              htmlFor="photo-fallback"
              className="cursor-pointer text-xs font-bold text-emerald-700"
            >
              {photoBusy ? 'Okunuyor...' : 'Fotoğraf çek'}
              <input
                id="photo-fallback"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(event) => void handlePhoto(event)}
                className="sr-only"
              />
            </label>
          </div>

          {manualError ? (
            <p role="alert" className="text-xs font-semibold text-rose-700">
              {manualError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Hedef çerçevesi ve tarama çizgisi. */
function ScanOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
      <div className="relative h-56 w-56 rounded-3xl border-2 border-emerald-400/80 shadow-[0_0_24px_rgba(52,211,153,0.35)]">
        <span className="absolute -left-1 -top-1 h-8 w-8 rounded-tl-xl border-l-4 border-t-4 border-emerald-400" />
        <span className="absolute -right-1 -top-1 h-8 w-8 rounded-tr-xl border-r-4 border-t-4 border-emerald-400" />
        <span className="absolute -bottom-1 -left-1 h-8 w-8 rounded-bl-xl border-b-4 border-l-4 border-emerald-400" />
        <span className="absolute -bottom-1 -right-1 h-8 w-8 rounded-br-xl border-b-4 border-r-4 border-emerald-400" />
        <span className="absolute left-0 top-0 h-1 w-full animate-[bounce_1.6s_infinite] bg-gradient-to-r from-transparent via-emerald-400 to-transparent" />
      </div>
      <p className="mt-4 rounded-full border border-zinc-700 bg-zinc-900/90 px-4 py-1.5 text-xs font-bold text-zinc-100">
        Karekodu çerçeveye tutun
      </p>
    </div>
  );
}

const errorMessages: Record<ScannerErrorKind, { title: string; detail: string }> = {
  insecure: {
    title: 'Güvenli bağlantı gerekiyor',
    detail:
      'Tarayıcılar kamerayı yalnızca HTTPS adreslerinde açıyor. Uygulamayı güvenli adresten açın; bu arada kodu elle yazabilir veya fotoğraf çekebilirsiniz.',
  },
  permission: {
    title: 'Kamera izni verilmedi',
    detail:
      'Tarayıcının adres çubuğundaki izin simgesinden kameraya izin verip yeniden başlatın.',
  },
  'no-camera': {
    title: 'Kamera bulunamadı',
    detail: 'Bu cihazda kullanılabilir bir kamera görünmüyor. Kodu elle girebilirsiniz.',
  },
  unknown: {
    title: 'Kamera başlatılamadı',
    detail: 'Kamerayı başka bir uygulama kullanıyor olabilir. Kapatıp yeniden deneyin.',
  },
};

function classifyCameraError(error: unknown): ScannerErrorKind {
  const name = error instanceof Error ? error.name : '';

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'permission';
  }

  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'no-camera';
  }

  return 'unknown';
}
