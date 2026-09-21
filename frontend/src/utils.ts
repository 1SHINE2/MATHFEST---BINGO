// DEFAULT PUBLIC CLOUD BACKEND URL (Render) — Change this to your live Render backend URL if needed
export const DEFAULT_PUBLIC_BACKEND = 'https://mathfest-bingo.onrender.com';


export const getBackendUrl = (): string => {
  if (typeof window !== 'undefined') {
    // 1. User manual override (saved via settings modal)
    const saved = localStorage.getItem('MATHFEST_API_URL');
    if (saved && saved.trim()) {
      return saved.trim().replace(/\/+$/, '');
    }

    // 2. Vite environment variable (configured in Vercel settings)
    const meta = import.meta as any;
    if (meta && meta.env && meta.env.VITE_API_URL) {
      return meta.env.VITE_API_URL.trim().replace(/\/+$/, '');
    }

    const { protocol, hostname, port } = window.location;

    // 3. Localhost or local network dev server (Host laptop running START BINGO.bat)
    if (hostname === 'localhost' || hostname === '127.0.0.1' || port === '5173' || port === '4173' || port === '3000') {
      return `${protocol}//${hostname}:3001`;
    }

    // 4. Public Vercel deployment -> use relative URL so vercel.json proxy handles requests seamlessly
    if (hostname.includes('vercel.app')) {
      return '';
    }

    // 5. Default fallback to public cloud backend
    return DEFAULT_PUBLIC_BACKEND;
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
