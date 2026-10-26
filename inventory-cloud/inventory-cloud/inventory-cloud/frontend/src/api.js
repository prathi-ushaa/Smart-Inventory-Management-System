let token = localStorage.getItem('token') || '';

export const setToken = (t) => {
  token = t;
  t ? localStorage.setItem('token', t) : localStorage.removeItem('token');
};

// body can be a plain object (sent as JSON) or FormData (file upload). raw: true returns a Blob.
export async function api(path, { method = 'GET', body, raw } = {}) {
  const isForm = body instanceof FormData;
  const res = await fetch('/api' + path, {
    method,
    headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), Authorization: 'Bearer ' + token },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  if (raw && res.ok) return res.blob();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
