export const shop = {
  name: "4Nguru The Brand Online",
  email: "malandela03@gmail.com",
  phone: "+27 67 868 4428",        // display format
  whatsappNumber: "27678684428",   // international, digits only, for wa.me
  social: {
    tiktok: "https://www.tiktok.com/@4nguru",
    instagram: "https://www.instagram.com/4nguruthebrand",
    facebook: "https://www.facebook.com/p/4nguru-The-Brand-100063554708976/",
  },
} as const;

export const whatsappLink = (text?: string): string =>
  `https://wa.me/${shop.whatsappNumber}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
