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
  | { type: 'hydrate'; lines: CartLine[] };

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
      return { ...state, lines: action.lines };
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

export function CartProvider({
  slug,
  children,
}: {
  slug: string;
  children: ReactNode;
}): ReactNode {
  const [state, dispatch] = useReducer(reducer, { slug, lines: [] });

  // Rehidratacion al montar (y al cambiar de restaurante).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(slug));
      dispatch({ type: 'hydrate', lines: raw ? (JSON.parse(raw) as CartLine[]) : [] });
    } catch {
      dispatch({ type: 'hydrate', lines: [] });
    }
  }, [slug]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(slug), JSON.stringify(state.lines));
    } catch {
      /* sin persistencia: el carrito dura lo que la pestaña */
    }
  }, [slug, state.lines]);

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
