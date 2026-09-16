(() => {
  const loginView = document.querySelector("#loginView");
  const appShell = document.querySelector("#appShell");
  const button = document.querySelector("#googleLoginButton");
  const loginMessage = document.querySelector("#loginMessage");
  const accountEmail = document.querySelector("#accountEmail");
  const logout = document.querySelector("#logout");
  const listeners = new Set();
  let client = null;
  let currentSession = null;

  function showSession(session) {
    currentSession = session || null;
    const signedIn = Boolean(currentSession?.access_token);
    loginView.hidden = signedIn;
    appShell.hidden = !signedIn;
    accountEmail.textContent = currentSession?.user?.email || "Usuário autorizado";
    listeners.forEach((listener) => listener(currentSession));
  }

  function setLoginMessage(text, isError = false) {
    loginMessage.textContent = text;
    loginMessage.classList.toggle("error", isError);
  }

  async function initialize() {
    try {
      const response = await fetch("/auth-config", { cache: "no-store" });
      if (!response.ok) throw new Error("Configuração do Supabase não encontrada.");
      const config = await response.json();
      if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase?.createClient) {
        throw new Error("A autenticação ainda não foi configurada.");
      }
      client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      showSession(data.session);
      client.auth.onAuthStateChange((_event, session) => showSession(session));
      return data.session;
    } catch (error) {
      showSession(null);
      setLoginMessage(error.message || "Não foi possível iniciar o login.", true);
      button.disabled = true;
      return null;
    }
  }

  button.addEventListener("click", async () => {
    if (!client) return;
    button.disabled = true;
    setLoginMessage("Abrindo o Google…");
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin }
    });
    if (error) {
      button.disabled = false;
      setLoginMessage("Não foi possível abrir o login do Google.", true);
    }
  });

  logout.addEventListener("click", async () => {
    if (client) await client.auth.signOut();
    showSession(null);
    setLoginMessage("Sessão encerrada.");
  });

  window.NeoVisionAuth = {
    ready: initialize(),
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async getAccessToken() {
      if (!client) await this.ready;
      const { data } = await client.auth.getSession();
      return data.session?.access_token || null;
    }
  };
})();
