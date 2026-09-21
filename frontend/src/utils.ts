export const getBackendUrl = (): string => {
  const meta = import.meta as any;
  if (meta && meta.env && meta.env.VITE_API_URL) {
    return meta.env.VITE_API_URL;
  }
  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location;
    if (port === '5173' || port === '4173' || port === '3000') {
      return protocol + '//' + hostname + ':3001';
    }
    return protocol + '//' + hostname + (port ? ':' + port : '');
  }
  return 'http://localhost:3001';
};
