const param = new URLSearchParams(location.search).get("theme");
const system = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
document.documentElement.dataset.theme = param === "dark" || param === "light" ? param : system;
