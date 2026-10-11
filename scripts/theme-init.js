try {
  if (localStorage.getItem("blueNightTheme") === "light") {
    document.documentElement.classList.add("light");
  }
} catch {
  // Private mode or restricted storage: keep the default dark theme.
}
