export const getBackendUrl = (): string => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('MATHFEST_API_URL');
    if (saved && saved.trim()) {
      return saved.trim().replace(/\/+$/, '');
    }
    const meta = import.meta as any;
    if (meta && meta.env && meta.env.VITE_API_URL) {
      return meta.env.VITE_API_URL;
    }
    const { protocol, hostname, port } = window.location;
    if (port === '5173' || port === '4173' || port === '3000') {
      return protocol + '//' + hostname + ':3001';
    }
    return protocol + '//' + hostname + (port ? ':' + port : '');
  }
  return 'http://localhost:3001';
};

export const setCustomBackendUrl = (url: string) => {
  if (typeof window !== 'undefined') {
    if (!url || !url.trim()) {
      localStorage.removeItem('MATHFEST_API_URL');
    } else {
      let formatted = url.trim();
      if (!/^https?:\/\//i.test(formatted)) {
        formatted = 'https://' + formatted;
      }
      localStorage.setItem('MATHFEST_API_URL', formatted.replace(/\/+$/, ''));
    }
  }
};
