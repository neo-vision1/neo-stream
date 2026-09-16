(() => {
  const loginView = document.querySelector("#loginView");
  const appShell = document.querySelector("#appShell");
  const form = document.querySelector("#loginForm");
  const email = document.querySelector("#loginEmail");
  const password = document.querySelector("#loginPassword");
  const button = document.querySelector("#loginButton");
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

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!client) return;
    button.disabled = true;
    setLoginMessage("Entrando…");
    const { data, error } = await client.auth.signInWithPassword({
      email: email.value.trim(),
      password: password.value
    });
    password.value = "";
    button.disabled = false;
    if (error) {
      setLoginMessage("E-mail ou senha incorretos.", true);
      return;
    }
    setLoginMessage("Acesso autorizado.");
    showSession(data.session);
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
