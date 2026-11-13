const KEY = 'flowforge_token';

// "Remember me" controls which storage the token lives in: localStorage
// persists across browser restarts, sessionStorage clears when the tab closes.
export function getToken() {
  return localStorage.getItem(KEY) || sessionStorage.getItem(KEY);
}

export function setToken(token, remember = true) {
  clearToken();
  (remember ? localStorage : sessionStorage).setItem(KEY, token);
}

export function clearToken() {
  localStorage.removeItem(KEY);
  sessionStorage.removeItem(KEY);
}
