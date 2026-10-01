/**
 * QR del menu: generacion por mesa, descarga en PDF para imprimir y enlaces
 * para compartir la carta por WhatsApp o mail.
 */
import { useState, type ReactNode } from 'react';

import { ErrorState, Spinner } from '../../components/ui.js';
import { ApiError, adminApi, downloadQrPdf } from '../../lib/api.js';
import { relativeTime } from '../../lib/format.js';
import { useAsync } from '../../lib/useAsync.js';
import { useToast } from '../../store/toast.js';

export function QrPage(): ReactNode {
  const toast = useToast();
  const [tablesText, setTablesText] = useState('1, 2, 3, 4, 5, 6');
  const [perPage, setPerPage] = useState(4);
  const [downloading, setDownloading] = useState(false);

  const tables = tablesText
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const { data: share, loading, error, reload } = useAsync(
    (signal) => adminApi.share(signal),
    [],
  );
  const { data: stats, reload: reloadStats } = useAsync(
    (signal) => adminApi.qrStats(signal),
    [],
  );

  const download = async () => {
    setDownloading(true);
    try {
      await downloadQrPdf(tables, perPage);
      // Generar los QR crea los que faltaban: el informe de escaneos cambia.
      reloadStats();
      toast.show('PDF generado');
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : 'No se pudo generar', 'error');
    } finally {
      setDownloading(false);
    }
  };

  if (loading && !share) return <Spinner label="Preparando los QR" />;
  if (error) return <ErrorState message={error.message} onRetry={reload} />;

  return (
    <div className="stack stack-5" style={{ maxWidth: 680 }}>
      <header className="stack stack-2">
        <h1>QR y compartir</h1>
        <p className="small muted">
          Un QR por mesa: el pedido entra identificado y cada escaneo queda contado.
        </p>
      </header>

      <section className="card card-pad stack stack-3">
        <h3>Imprimir para las mesas</h3>
        <label className="field">
          <span className="label">Mesas (separadas por coma)</span>
          <input
            className="input"
            value={tablesText}
            onChange={(e) => setTablesText(e.target.value)}
            placeholder="1, 2, 3, Barra, Terraza"
          />
          <span className="tiny muted">
            Si lo dejas vacio se genera un unico QR general del local.
          </span>
        </label>

        <label className="field">
          <span className="label">Tarjetas por pagina</span>
          <select
            className="select"
            value={perPage}
            onChange={(e) => setPerPage(Number(e.target.value))}
          >
            <option value={1}>1 (tamaño A4 completo)</option>
            <option value={2}>2 por pagina</option>
            <option value={4}>4 por pagina</option>
          </select>
        </label>

        <button
          type="button"
          className="btn btn-primary"
          disabled={downloading}
          onClick={() => void download()}
        >
          {downloading ? 'Generando...' : `Descargar PDF (${tables.length || 1} QR)`}
        </button>
      </section>

      <section className="card card-pad stack stack-3">
        <h3>Compartir la carta</h3>
        <div className="field">
          <span className="label">Enlace del menu</span>
          <div className="row" style={{ gap: 8 }}>
            <input className="input grow" readOnly value={share?.menuUrl ?? ''} />
            <button
              type="button"
              className="btn btn-sm"
              onClick={async () => {
                if (!share) return;
                try {
                  await navigator.clipboard.writeText(share.menuUrl);
                  toast.show('Enlace copiado');
                } catch {
                  toast.show('No pudimos copiar el enlace', 'error');
                }
              }}
            >
              Copiar
            </button>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {share && (
            <>
              <a className="btn btn-sm" href={share.whatsapp} target="_blank" rel="noreferrer">
                Compartir por WhatsApp
              </a>
              <a className="btn btn-sm" href={share.email}>
                Compartir por mail
              </a>
            </>
          )}
        </div>
      </section>

      {stats && stats.length > 0 && (
        <section className="card card-pad stack stack-3">
          <h3>Escaneos por mesa</h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Mesa</th>
                  <th scope="col" className="num">Escaneos</th>
                  <th scope="col">Ultimo</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((row) => (
                  <tr key={row.token}>
                    <th scope="row">{row.tableLabel ?? 'General'}</th>
                    <td className="num">{row.scans}</td>
                    <td className="secondary">
                      {row.lastScanAt ? relativeTime(row.lastScanAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
