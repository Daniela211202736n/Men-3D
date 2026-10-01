/**
 * Visor 3D y de realidad aumentada.
 *
 * Usa <model-viewer> (Google) en vez de three.js a pelo por una razon concreta:
 * resuelve los dos caminos de RA que existen hoy en un celular sin instalar
 * nada —  Scene Viewer / WebXR en Android y AR Quick Look en iOS — y expone
 * `canActivateAR` para poder esconder el boton cuando el dispositivo no puede.
 *
 * Carga diferida: el bundle de <model-viewer> (~300 KB) se importa recien
 * cuando el componente entra en pantalla, para no castigar la carga de la carta.
 */
import { useEffect, useRef, useState } from 'react';

import { AnalyticsEvent, track } from '../lib/analytics.js';

/** Elemento personalizado: TS no lo conoce, se declara su interfaz minima. */
interface ModelViewerElement extends HTMLElement {
  canActivateAR?: boolean;
  activateAR?: () => Promise<void>;
  cameraOrbit?: string;
  resetTurntableRotation?: (radians?: number) => void;
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        src?: string;
        'ios-src'?: string;
        alt?: string;
        poster?: string;
        ar?: boolean | '';
        'ar-modes'?: string;
        'ar-scale'?: string;
        'ar-placement'?: string;
        'camera-controls'?: boolean | '';
        'touch-action'?: string;
        'auto-rotate'?: boolean | '';
        'auto-rotate-delay'?: number;
        'rotation-per-second'?: string;
        'shadow-intensity'?: string;
        'shadow-softness'?: string;
        'environment-image'?: string;
        exposure?: string;
        'camera-orbit'?: string;
        'min-camera-orbit'?: string;
        'max-camera-orbit'?: string;
        'field-of-view'?: string;
        loading?: 'auto' | 'lazy' | 'eager';
        reveal?: 'auto' | 'manual' | 'interaction';
        'disable-pan'?: boolean | '';
      };
    }
  }
}

/** El modulo se carga una sola vez, aunque haya varios visores en la pagina. */
let loaderPromise: Promise<unknown> | null = null;
function loadModelViewer(): Promise<unknown> {
  loaderPromise ??= import('@google/model-viewer');
  return loaderPromise;
}

export interface DishViewer3DProps {
  dishId: string;
  dishName: string;
  glbUrl: string;
  usdzUrl?: string | null;
  posterUrl?: string | null;
  portionLabel?: string | null;
  rotateHint: string;
  arLabel: string;
  arHint: string;
}

export function DishViewer3D({
  dishId,
  dishName,
  glbUrl,
  usdzUrl,
  posterUrl,
  portionLabel,
  rotateHint,
  arLabel,
  arHint,
}: DishViewer3DProps): React.ReactNode {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<ModelViewerElement | null>(null);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const [canAr, setCanAr] = useState(false);
  const [failed, setFailed] = useState(false);

  // --- carga diferida al entrar en pantalla --------------------------------
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Sin IntersectionObserver (navegadores viejos) se carga directamente.
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      // 200px de margen: empieza a cargar justo antes de que se vea.
      { rootMargin: '200px' },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    loadModelViewer()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  // --- analitica: tiempo en pantalla y giros -------------------------------
  const viewStartRef = useRef<number | null>(null);
  const rotateCountRef = useRef(0);

  useEffect(() => {
    if (!ready) return;
    viewStartRef.current = Date.now();
    rotateCountRef.current = 0;

    return () => {
      // El tiempo con el modelo en pantalla se reporta al desmontar: es la
      // señal que alimenta "avgViewSeconds" en el panel del restaurante.
      const start = viewStartRef.current;
      if (start) {
        track(AnalyticsEvent.DISH_VIEW_3D, {
          dishId,
          durationMs: Math.min(Date.now() - start, 30 * 60 * 1000),
        });
      }
    };
  }, [ready, dishId]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready) return;

    const onCameraChange = (event: Event) => {
      // `camera-change` dispara en cada frame de arrastre: se cuenta un giro
      // cada 12 frames para no inundar la cola de eventos.
      const detail = (event as CustomEvent<{ source?: string }>).detail;
      if (detail?.source !== 'user-interaction') return;
      rotateCountRef.current += 1;
      if (rotateCountRef.current % 12 === 0) {
        track(AnalyticsEvent.DISH_ROTATE, { dishId });
      }
    };

    const onLoad = () => {
      setCanAr(Boolean(viewer.canActivateAR));
    };
    const onError = () => setFailed(true);

    viewer.addEventListener('camera-change', onCameraChange);
    viewer.addEventListener('load', onLoad);
    viewer.addEventListener('error', onError);
    return () => {
      viewer.removeEventListener('camera-change', onCameraChange);
      viewer.removeEventListener('load', onLoad);
      viewer.removeEventListener('error', onError);
    };
  }, [ready, dishId]);

  const launchAr = async () => {
    const viewer = viewerRef.current;
    if (!viewer?.activateAR) return;
    track(AnalyticsEvent.AR_LAUNCH, { dishId });
    try {
      await viewer.activateAR();
    } catch {
      // El usuario puede cancelar el permiso de camara: no es un error nuestro.
    }
  };

  return (
    <div className="viewer-wrap" ref={hostRef}>
      {!ready && !failed && (
        <div
          className="viewer skeleton"
          role="status"
          aria-label="Cargando el modelo 3D"
        />
      )}

      {failed && (
        // Degradacion: si el modelo no carga queda la foto, no un hueco.
        <div className="viewer" style={{ display: 'grid', placeItems: 'center' }}>
          {posterUrl ? (
            <img src={posterUrl} alt={dishName} style={{ maxHeight: '100%' }} />
          ) : (
            <p className="muted small center" style={{ padding: 24 }}>
              No pudimos cargar la vista 3D de este plato.
            </p>
          )}
        </div>
      )}

      {ready && !failed && (
        <>
          <model-viewer
            ref={viewerRef as React.Ref<HTMLElement>}
            className="viewer"
            src={glbUrl}
            ios-src={usdzUrl ?? undefined}
            poster={posterUrl ?? undefined}
            alt={`Modelo 3D de ${dishName}`}
            ar
            // `webxr` primero (experiencia nativa en Android), `scene-viewer`
            // como respaldo y `quick-look` para iOS.
            ar-modes="webxr scene-viewer quick-look"
            // El plato se coloca sobre una superficie horizontal, a escala real:
            // ver la porcion real es justamente el punto del producto.
            ar-placement="floor"
            ar-scale="fixed"
            camera-controls
            // `pan-y` deja que la pagina siga scrolleando con un dedo y reserva
            // el giro del modelo al arrastre horizontal.
            touch-action="pan-y"
            auto-rotate
            auto-rotate-delay={2500}
            rotation-per-second="18deg"
            shadow-intensity="1"
            shadow-softness="0.8"
            exposure="1.05"
            environment-image="neutral"
            camera-orbit="35deg 72deg 0.75m"
            min-camera-orbit="auto 0deg auto"
            max-camera-orbit="auto 92deg auto"
            loading="eager"
          />
          {portionLabel && <span className="portion-pill">{portionLabel}</span>}
          {canAr && (
            <button
              type="button"
              className="btn btn-primary btn-sm viewer-ar-btn"
              onClick={() => void launchAr()}
              title={arHint}
            >
              <CubeIcon /> {arLabel}
            </button>
          )}
          <span className="viewer-hint">{rotateHint}</span>
        </>
      )}
    </div>
  );
}

function CubeIcon(): React.ReactNode {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2l9 5v10l-9 5-9-5V7z" />
      <path d="M12 12l9-5M12 12v10M12 12L3 7" />
    </svg>
  );
}
