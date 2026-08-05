import React, { createContext, forwardRef, useCallback, useContext, useMemo } from 'react';
import { Router as WouterRouter, useLocation as useWouterLocation } from 'wouter';

const OutletContext = createContext(null);

function normalizePath(value) {
  const path = String(value || '/').split('?')[0].split('#')[0] || '/';
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

function routeMatches(pattern, pathname) {
  if (!pattern) return false;
  if (pattern === '*' || pattern === '/*') return true;
  return normalizePath(pattern) === normalizePath(pathname);
}

function findRoute(children, pathname) {
  for (const child of React.Children.toArray(children)) {
    if (!React.isValidElement(child) || child.type !== Route) continue;
    const nested = child.props.children ? findRoute(child.props.children, pathname) : null;
    if (!child.props.path && nested) {
      return child.props.element ? [child.props.element, ...nested] : nested;
    }
    if (routeMatches(child.props.path, pathname)) {
      const own = child.props.element ? [child.props.element] : [];
      return nested ? [...own, ...nested] : own;
    }
  }
  return null;
}

function renderRouteChain(chain, index = 0) {
  if (!chain || index >= chain.length) return null;
  return (
    <OutletContext.Provider value={renderRouteChain(chain, index + 1)}>
      {chain[index]}
    </OutletContext.Provider>
  );
}

export function BrowserRouter({ children }) {
  return <WouterRouter>{children}</WouterRouter>;
}

export function Route() {
  return null;
}

export function Routes({ children }) {
  const location = useLocation();
  return renderRouteChain(findRoute(children, location.pathname));
}

export function Outlet() {
  return useContext(OutletContext);
}

export function useLocation() {
  const [pathname] = useWouterLocation();
  return useMemo(() => ({
    pathname: normalizePath(pathname),
    search: window.location.search,
    hash: window.location.hash,
    state: window.history.state
  }), [pathname]);
}

export function useNavigate() {
  const [, navigate] = useWouterLocation();
  return useCallback((target, options = {}) => {
    navigate(String(target || '/'), { replace: !!options.replace, state: options.state });
  }, [navigate]);
}

export function Navigate({ to, replace = false, state }) {
  const navigate = useNavigate();
  React.useEffect(() => navigate(to, { replace, state }), [navigate, replace, state, to]);
  return null;
}

export const Link = forwardRef(function Link({ to, href, onClick, target, children, ...props }, ref) {
  const navigate = useNavigate();
  const destination = String(to || href || '/');
  const handleClick = (event) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(destination);
  };
  return <a ref={ref} href={destination} target={target} onClick={handleClick} {...props}>{children}</a>;
});

export function useSearchParams() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const setParams = useCallback((next, options = {}) => {
    const value = next instanceof URLSearchParams ? next : new URLSearchParams(next);
    navigate(`${location.pathname}${value.toString() ? `?${value}` : ''}`, options);
  }, [location.pathname, navigate]);
  return [params, setParams];
}
