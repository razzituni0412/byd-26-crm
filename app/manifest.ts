import type { MetadataRoute } from "next";

const APP_ICON = "/icons/app-icon.png";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CRM מימון רכבים",
    short_name: "CRM מימון רכבים",
    description: "דשבורד CRM עתידני לסוכני מימון רכבים",
    start_url: "/",
    display: "standalone",
    background_color: "#03060d",
    theme_color: "#03060d",
    icons: [
      {
        src: APP_ICON,
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: APP_ICON,
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: APP_ICON,
        sizes: "1024x1024",
        type: "image/png",
        purpose: "any",
      },
      {
        src: APP_ICON,
        sizes: "1024x1024",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
