export const DARK_MODE_KEY = "landing-theme";

export const DARK_MODE_ATTRIBUTE = "data-landing-theme";

export const DARK_MODE_BOOT = `try{if(localStorage.getItem("${DARK_MODE_KEY}")==="dark")document.documentElement.setAttribute("${DARK_MODE_ATTRIBUTE}","dark")}catch(e){}`;
