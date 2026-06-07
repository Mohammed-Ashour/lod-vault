(() => {
  let nextSessionId = 0;

  function createSessionController() {
    let activeSession = null;

    function close(session = activeSession) {
      if (!session) {
        activeSession = null;
        return;
      }

      session.closed = true;
      if (activeSession?.id === session.id) {
        activeSession = null;
      }
    }

    function isActive(session) {
      return Boolean(session && !session.closed && activeSession?.id === session.id);
    }

    function createSession(query, mode) {
      close(activeSession);

      const session = {
        id: ++nextSessionId,
        query: String(query || ""),
        mode: mode === "sentence" ? "sentence" : "word",
        closed: false,
        data: {},
        isActive() {
          return isActive(session);
        },
        guard(callback) {
          if (!isActive(session)) {
            return false;
          }

          callback?.(session);
          return true;
        }
      };

      activeSession = session;
      return session;
    }

    function getActive() {
      return activeSession;
    }

    return {
      createSession,
      close,
      isActive,
      getActive
    };
  }

  globalThis.LodVaultLensSession = {
    createSessionController
  };
})();
