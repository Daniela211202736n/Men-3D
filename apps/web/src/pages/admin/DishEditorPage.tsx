/**
 * Editor de plato: datos, alergenos, dietas, ingredientes y modelo 3D.
 *
 * La subida del GLB muestra el peso del archivo porque es el dato que decide si
 * la carta va a cargar rapido en el celular de un comensal: por encima de ~3 MB
 * conviene optimizar el modelo antes de publicarlo.
 */
import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Allergen, DietTag, type DishDto } from '@men3d/shared';

import { DishViewer3D } from '../../components/DishViewer3D.js';
import { ErrorState, Spinner } from '../../components/ui.js';
import { ApiError, adminApi, uploadAsset } from '../../lib/api.js';
import { allergenLabel, dietLabel } from '../../lib/i18n.js';
import { useAsync } from '../../lib/useAsync.js';
import { useToast } from '../../store/toast.js';

interface FormState {
  categoryId: string;
  name: string;
  description: string;
  pricePesos: string;
  comparePesos: string;
  imageUrl: string;
  modelGlbUrl: string;
  modelUsdzUrl: string;
  portionGrams: string;
  calories: string;
  prepMinutes: string;
  isAvailable: boolean;
  isFeatured: boolean;
  allergens: string[];
  dietTags: string[];
  ingredients: string;
}

const EMPTY: FormState = {
  categoryId: '',
  name: '',
  description: '',
  pricePesos: '',
  comparePesos: '',
  imageUrl: '',
  modelGlbUrl: '',
  modelUsdzUrl: '',
  portionGrams: '',
  calories: '',
  prepMinutes: '',
  isAvailable: true,
  isFeatured: false,
  allergens: [],
  dietTags: [],
  ingredients: '',
};

function fromDish(dish: DishDto): FormState {
  return {
    categoryId: dish.categoryId,
    name: dish.name,
    description: dish.description ?? '',
    pricePesos: (dish.priceCents / 100).toFixed(2),
    comparePesos: dish.compareAtPriceCents
      ? (dish.compareAtPriceCents / 100).toFixed(2)
      : '',
    imageUrl: dish.imageUrl ?? '',
    modelGlbUrl: dish.modelGlbUrl ?? '',
    modelUsdzUrl: dish.modelUsdzUrl ?? '',
    portionGrams: dish.portionGrams?.toString() ?? '',
    calories: dish.calories?.toString() ?? '',
    prepMinutes: dish.prepMinutes?.toString() ?? '',
    isAvailable: dish.isAvailable,
    isFeatured: dish.isFeatured,
    allergens: [...dish.allergens],
    dietTags: [...dish.dietTags],
    ingredients: dish.ingredients.join(', '),
  };
}

const toCents = (value: string): number =>
  Math.round(Number(value.replace(',', '.')) * 100);

const toIntOrNull = (value: string): number | null =>
  value.trim() === '' ? null : Math.round(Number(value));

export function DishEditorPage(): ReactNode {
  const { dishId } = useParams();
  const isNew = !dishId || dishId === 'nuevo';
  const navigate = useNavigate();
  const toast = useToast();

  const { data: categories } = useAsync((signal) => adminApi.categories(signal), []);
  const { data: dishes, loading, error } = useAsync(
    (signal) => (isNew ? Promise.resolve([]) : adminApi.dishes(true, signal)),
    [isNew],
  );

  const existing = isNew ? null : dishes?.find((d) => d.id === dishId);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // El formulario se inicializa una vez que llegaron los datos.
  const state =
    form ??
    (existing ? fromDish(existing) : { ...EMPTY, categoryId: categories?.[0]?.id ?? '' });

  const update = (patch: Partial<FormState>) => setForm({ ...state, ...patch });

  const toggle = (key: 'allergens' | 'dietTags', value: string) =>
    update({
      [key]: state[key].includes(value)
        ? state[key].filter((v) => v !== value)
        : [...state[key], value],
    } as Partial<FormState>);

  const upload = async (file: File, field: 'modelGlbUrl' | 'modelUsdzUrl' | 'imageUrl') => {
    setUploading(true);
    try {
      const { url, bytes } = await uploadAsset(file);
      update({ [field]: url } as Partial<FormState>);
      const mb = bytes / (1024 * 1024);
      toast.show(
        mb > 3
          ? `Subido (${mb.toFixed(1)} MB). Conviene optimizarlo: arriba de 3 MB la carta tarda en el celular.`
          : `Subido (${mb.toFixed(2)} MB)`,
      );
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : 'Fallo la subida', 'error');
    } finally {
      setUploading(false);
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const payload = {
        categoryId: state.categoryId,
        name: state.name,
        description: state.description || undefined,
        priceCents: toCents(state.pricePesos),
        compareAtPriceCents: state.comparePesos ? toCents(state.comparePesos) : null,
        imageUrl: state.imageUrl || null,
        modelGlbUrl: state.modelGlbUrl || null,
        modelUsdzUrl: state.modelUsdzUrl || null,
        portionGrams: toIntOrNull(state.portionGrams),
        calories: toIntOrNull(state.calories),
        prepMinutes: toIntOrNull(state.prepMinutes),
        isAvailable: state.isAvailable,
        isFeatured: state.isFeatured,
        allergens: state.allergens,
        dietTags: state.dietTags,
        ingredients: state.ingredients
          .split(',')
          .map((i) => i.trim())
          .filter(Boolean),
      };

      if (isNew) await adminApi.createDish(payload);
      else await adminApi.updateDish(dishId!, payload);

      toast.show(isNew ? 'Plato creado' : 'Cambios guardados');
      navigate('/admin/carta');
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : 'No se pudo guardar', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!isNew && loading) return <Spinner label="Cargando el plato" />;
  if (error) return <ErrorState message={error.message} />;
  if (!isNew && !existing) return <ErrorState message="No encontramos este plato" />;

  return (
    <form className="stack stack-5" onSubmit={save} style={{ maxWidth: 680 }}>
      <header className="stack stack-2">
        <h1>{isNew ? 'Nuevo plato' : state.name || 'Editar plato'}</h1>
        <p className="small muted">
          Los campos de porcion y alergenos son los que mas consultan los comensales.
        </p>
      </header>

      <div className="card card-pad stack stack-3">
        <label className="field">
          <span className="label">Nombre *</span>
          <input
            className="input"
            required
            maxLength={100}
            value={state.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        </label>

        <label className="field">
          <span className="label">Categoria *</span>
          <select
            className="select"
            required
            value={state.categoryId}
            onChange={(e) => update({ categoryId: e.target.value })}
          >
            <option value="">Elegir...</option>
            {categories?.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="label">Descripcion</span>
          <textarea
            className="textarea"
            maxLength={1000}
            value={state.description}
            onChange={(e) => update({ description: e.target.value })}
          />
        </label>

        <div className="row wrap" style={{ gap: 12 }}>
          <label className="field grow">
            <span className="label">Precio *</span>
            <input
              className="input nums"
              required
              inputMode="decimal"
              value={state.pricePesos}
              onChange={(e) => update({ pricePesos: e.target.value })}
            />
          </label>
          <label className="field grow">
            <span className="label">Precio anterior (promo)</span>
            <input
              className="input nums"
              inputMode="decimal"
              value={state.comparePesos}
              onChange={(e) => update({ comparePesos: e.target.value })}
            />
          </label>
        </div>

        <div className="row wrap" style={{ gap: 12 }}>
          <label className="field grow">
            <span className="label">Porcion (g)</span>
            <input
              className="input nums"
              inputMode="numeric"
              value={state.portionGrams}
              onChange={(e) => update({ portionGrams: e.target.value })}
            />
          </label>
          <label className="field grow">
            <span className="label">Calorias</span>
            <input
              className="input nums"
              inputMode="numeric"
              value={state.calories}
              onChange={(e) => update({ calories: e.target.value })}
            />
          </label>
          <label className="field grow">
            <span className="label">Minutos de preparacion</span>
            <input
              className="input nums"
              inputMode="numeric"
              value={state.prepMinutes}
              onChange={(e) => update({ prepMinutes: e.target.value })}
            />
          </label>
        </div>

        <label className="field">
          <span className="label">Ingredientes (separados por coma)</span>
          <input
            className="input"
            value={state.ingredients}
            placeholder="Ternera, pan rallado, huevo"
            onChange={(e) => update({ ingredients: e.target.value })}
          />
        </label>

        <div className="row wrap" style={{ gap: 16 }}>
          <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={state.isAvailable}
              onChange={(e) => update({ isAvailable: e.target.checked })}
            />
            <span className="small">Disponible</span>
          </label>
          <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={state.isFeatured}
              onChange={(e) => update({ isFeatured: e.target.checked })}
            />
            <span className="small">Destacar arriba de la carta</span>
          </label>
        </div>
      </div>

      <fieldset className="card card-pad stack stack-3" style={{ border: '1px solid var(--border)' }}>
        <legend className="label">Alergenos que contiene</legend>
        <div className="row wrap" style={{ gap: 8 }}>
          {Object.values(Allergen).map((allergen) => (
            <button
              key={allergen}
              type="button"
              className="chip"
              aria-pressed={state.allergens.includes(allergen)}
              onClick={() => toggle('allergens', allergen)}
            >
              {allergenLabel(allergen, 'es')}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="card card-pad stack stack-3" style={{ border: '1px solid var(--border)' }}>
        <legend className="label">Apto para</legend>
        <div className="row wrap" style={{ gap: 8 }}>
          {Object.values(DietTag).map((tag) => (
            <button
              key={tag}
              type="button"
              className="chip"
              aria-pressed={state.dietTags.includes(tag)}
              onClick={() => toggle('dietTags', tag)}
            >
              {dietLabel(tag, 'es')}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="card card-pad stack stack-3">
        <h3>Modelo 3D y foto</h3>
        <p className="small muted">
          El GLB se usa en la web y en la RA de Android. El USDZ es opcional y mejora
          la RA nativa de iOS.
        </p>

        <AssetField
          label="Modelo GLB"
          accept=".glb,model/gltf-binary"
          value={state.modelGlbUrl}
          disabled={uploading}
          onPick={(file) => void upload(file, 'modelGlbUrl')}
          onClear={() => update({ modelGlbUrl: '' })}
        />
        <AssetField
          label="Modelo USDZ (iOS, opcional)"
          accept=".usdz"
          value={state.modelUsdzUrl}
          disabled={uploading}
          onPick={(file) => void upload(file, 'modelUsdzUrl')}
          onClear={() => update({ modelUsdzUrl: '' })}
        />
        <AssetField
          label="Foto del plato"
          accept="image/png,image/jpeg,image/webp"
          value={state.imageUrl}
          disabled={uploading}
          onPick={(file) => void upload(file, 'imageUrl')}
          onClear={() => update({ imageUrl: '' })}
        />

        {state.modelGlbUrl && (
          <div className="stack stack-2">
            <span className="label">Previsualizacion</span>
            <DishViewer3D
              dishId={dishId ?? 'preview'}
              dishName={state.name || 'Plato'}
              glbUrl={state.modelGlbUrl}
              usdzUrl={state.modelUsdzUrl || null}
              posterUrl={state.imageUrl || null}
              portionLabel={state.portionGrams ? `Porcion ${state.portionGrams} g` : null}
              rotateHint="Arrastra para girar"
              arLabel="Probar RA"
              arHint="Apunta la camara a una mesa"
            />
          </div>
        )}
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={saving || uploading}>
          {saving ? 'Guardando...' : isNew ? 'Crear plato' : 'Guardar cambios'}
        </button>
        <button type="button" className="btn" onClick={() => navigate('/admin/carta')}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function AssetField({
  label,
  accept,
  value,
  disabled,
  onPick,
  onClear,
}: {
  label: string;
  accept: string;
  value: string;
  disabled: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
}): ReactNode {
  return (
    <div className="field">
      <span className="label">{label}</span>
      {value ? (
        <div className="row-between">
          <code className="tiny truncate grow">{value}</code>
          <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={onClear}>
            Quitar
          </button>
        </div>
      ) : (
        <input
          type="file"
          accept={accept}
          disabled={disabled}
          className="input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPick(file);
          }}
        />
      )}
    </div>
  );
}
