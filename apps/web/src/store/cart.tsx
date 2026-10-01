/**
 * Carrito. Vive en React Context y se persiste en localStorage por restaurante:
 * el comensal puede recargar la pagina (o volver al rato) sin perder el pedido.
 *
 * Guarda el precio al momento de agregar solo para *mostrar* el total; el precio
 * que se cobra lo recalcula siempre el backend desde la base.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';

import type { DishDto } from '@men3d/shared';

export interface CartLine {
  dishId: string;
  name: string;
  priceCents: number;
  quantity: number;
  notes?: string;
  imageUrl: string | null;
}

interface CartState {
  slug: string;
  lines: CartLine[];
}

type CartAction =
  | { type: 'add'; dish: DishDto; quantity: number; notes?: string }
  | { type: 'setQuantity'; dishId: string; quantity: number }
  | { type: 'remove'; dishId: string }
  | { type: 'clear' }
  /** Carga el carrito guardado de un restaurante; el slug viaja con las lineas. */
  | { type: 'hydrate'; slug: string; lines: CartLine[] };

function reducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'add': {
      const existing = state.lines.find((l) => l.dishId === action.dish.id);
      if (existing) {
        return {
          ...state,
          lines: state.lines.map((line) =>
            line.dishId === action.dish.id
              ? {
                  ...line,
                  quantity: Math.min(line.quantity + action.quantity, 50),
                  notes: action.notes ?? line.notes,
                }
              : line,
          ),
        };
      }
      return {
        ...state,
        lines: [
          ...state.lines,
          {
            dishId: action.dish.id,
            name: action.dish.name,
            priceCents: action.dish.priceCents,
            quantity: action.quantity,
            notes: action.notes,
            imageUrl: action.dish.imageUrl,
          },
        ],
      };
    }
    case 'setQuantity': {
      // Bajar a cero equivale a quitar la linea.
      if (action.quantity <= 0) {
        return { ...state, lines: state.lines.filter((l) => l.dishId !== action.dishId) };
      }
      return {
        ...state,
        lines: state.lines.map((line) =>
          line.dishId === action.dishId
            ? { ...line, quantity: Math.min(action.quantity, 50) }
            : line,
        ),
      };
    }
    case 'remove':
      return { ...state, lines: state.lines.filter((l) => l.dishId !== action.dishId) };
    case 'clear':
      return { ...state, lines: [] };
    case 'hydrate':
      return { slug: action.slug, lines: action.lines };
    default:
      return state;
  }
}

interface CartContextValue {
  lines: CartLine[];
  itemCount: number;
  subtotalCents: number;
  add: (dish: DishDto, quantity?: number, notes?: string) => void;
  setQuantity: (dishId: string, quantity: number) => void;
  remove: (dishId: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

const storageKey = (slug: string) => `men3d.cart.${slug}`;

function readStored(slug: string): CartLine[] {
  try {
    const raw = localStorage.getItem(storageKey(slug));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as CartLine[]) : [];
  } catch {
    // Storage bloqueado o contenido corrupto: se arranca con el carrito vacio.
    return [];
  }
}

export function CartProvider({
  slug,
  children,
}: {
  slug: string;
  children: ReactNode;
}): ReactNode {
  // El carrito guardado se lee al crear el estado, no en un efecto. Hacerlo en
  // un efecto abria una ventana en la que el efecto de guardado corria primero
  // y pisaba el almacenamiento con una lista vacia — y con el doble montaje de
  // StrictMode la segunda lectura ya encontraba ese vacio, asi que el carrito
  // se perdia en cada recarga.
  const [state, dispatch] = useReducer(reducer, slug, (initialSlug) => ({
    slug: initialSlug,
    lines: readStored(initialSlug),
  }));

  // Solo hace falta rehidratar al cambiar de restaurante; el inicial ya vino
  // cargado del inicializador.
  useEffect(() => {
    if (state.slug === slug) return;
    dispatch({ type: 'hydrate', slug, lines: readStored(slug) });
  }, [slug, state.slug]);

  useEffect(() => {
    // Mientras el estado siga siendo el del restaurante anterior no se guarda
    // nada: escribir ahi copiaria el carrito de un local en el de otro.
    if (state.slug !== slug) return;
    try {
      localStorage.setItem(storageKey(state.slug), JSON.stringify(state.lines));
    } catch {
      /* sin persistencia: el carrito dura lo que la pestaña */
    }
  }, [slug, state.slug, state.lines]);

  const value = useMemo<CartContextValue>(() => {
    const itemCount = state.lines.reduce((acc, l) => acc + l.quantity, 0);
    const subtotalCents = state.lines.reduce(
      (acc, l) => acc + l.priceCents * l.quantity,
      0,
    );
    return {
      lines: state.lines,
      itemCount,
      subtotalCents,
      add: (dish, quantity = 1, notes) =>
        dispatch({ type: 'add', dish, quantity, notes }),
      setQuantity: (dishId, quantity) =>
        dispatch({ type: 'setQuantity', dishId, quantity }),
      remove: (dishId) => dispatch({ type: 'remove', dishId }),
      clear: () => dispatch({ type: 'clear' }),
    };
  }, [state.lines]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart debe usarse dentro de <CartProvider>');
  return context;
}

/** Hook aparte para que el pie del carrito no re-renderice toda la carta. */
export function useCartCount(): number {
  return useCart().itemCount;
}
