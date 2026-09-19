/**
 * Tarama sesleri.
 *
 * Mağazada telefona bakmadan okutma yapıldığı için sesli geri bildirim önemli:
 * personel ekrana bakmadan okumanın tuttuğunu anlıyor.
 *
 * Ses dosyası indirmek yerine Web Audio ile üretiliyor; ek ağ isteği ve varlık
 * yönetimi gerekmiyor. Ses bağlamı ilk kullanıcı etkileşimine kadar askıda
 * kalabileceği için her çalmada devam ettirilmeye çalışılıyor.
 */

type BeepKind = 'success' | 'warning';

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const AudioContextClass =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextClass) {
    return null;
  }

  audioContext ??= new AudioContextClass();

  return audioContext;
}

/**
 * Kısa bir bip çalar.
 *
 * Sessiz modda veya ses izni yoksa sessizce vazgeçer; tarama akışını
 * kesmemesi gerekiyor.
 */
export function playBeep(kind: BeepKind = 'success'): void {
  try {
    const context = getAudioContext();
    if (!context) {
      return;
    }

    // iOS'ta bağlam ilk etkileşime kadar askıda başlar.
    if (context.state === 'suspended') {
      void context.resume();
    }

    const oscillator = context.createOscillator();
    const gain = context.createGain();

    // Başarıda yüksek ve kısa, uyarıda daha alçak ve uzun bir ton.
    oscillator.frequency.value = kind === 'success' ? 1180 : 420;
    oscillator.type = 'sine';

    const duration = kind === 'success' ? 0.09 : 0.2;
    const now = context.currentTime;

    // Ani kesme tık sesi ürettiği için ses seviyesi yumuşak iniyor.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  } catch {
    // Ses çalınamadıysa tarama yine de sürsün.
  }
}

/** Titreşim destekleniyorsa kısa bir dokunsal geri bildirim verir. */
export function vibrate(pattern: number | number[] = 40): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Desteklenmiyorsa önemsiz.
  }
}
