"use client";

import { useEffect } from "react";

const TRACECASE_URL = "https://tracecase.vercel.app";
const TRACECASE_PROJECT_KEY = "pk_QRJwzQCRh_6cGkNAQjeD_AnaJfIAsDkU";
const SCRIPT_ID = "tracecase-widget-script";

export function TracecaseReporter() {
  useEffect(() => {
    let active = true;
    let widget: HTMLElement | null = null;

    const mountWidget = () => {
      if (!active || widget || document.querySelector("tracecase-widget")) return;
      widget = document.createElement("tracecase-widget");
      widget.setAttribute("base-url", TRACECASE_URL);
      widget.setAttribute("project-key", TRACECASE_PROJECT_KEY);
      document.body.appendChild(widget);
    };

    const existingScript = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (customElements.get("tracecase-widget")) {
      mountWidget();
    } else if (existingScript) {
      existingScript.addEventListener("load", mountWidget, { once: true });
    } else {
      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = `${TRACECASE_URL}/tracecase-widget.js`;
      script.async = true;
      script.addEventListener("load", mountWidget, { once: true });
      document.head.appendChild(script);
    }

    return () => {
      active = false;
      existingScript?.removeEventListener("load", mountWidget);
      widget?.remove();
    };
  }, []);

  return null;
}
