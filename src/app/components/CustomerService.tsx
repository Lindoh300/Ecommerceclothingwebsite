import { HelpCircle, Truck, RefreshCcw, Ruler, Mail, Phone, MessageSquare, Facebook, Instagram } from "lucide-react";
import { Link } from "react-router";
import { shop, whatsappLink } from "../config/shop";

const pageLink = "text-ink underline underline-offset-4 hover:text-b60 transition-colors";

export function CustomerService() {
  const contactMethods = [
    {
      title: "Phone",
      detail: shop.phone,
      icon: <Phone className="w-6 h-6 text-ink" />
    },
    {
      title: "WhatsApp",
      detail: shop.phone,
      icon: <MessageSquare className="w-6 h-6 text-ink" />
    },
    {
      title: "Email",
      detail: shop.email,
      icon: <Mail className="w-6 h-6 text-ink" />
    }
  ];

  const sections = [
    {
      title: "Contact Us",
      icon: <Mail className="w-6 h-6 text-ink" />,
      content: (
        <div className="space-y-8">
          <p className="text-b60">Have questions about your order or our products? We're here to help!</p>
          <div className="grid sm:grid-cols-3 gap-4">
            {contactMethods.map((method) => (
              <div key={method.title} className="border border-b10 r-card hover:border-ink transition-colors p-6 flex flex-col gap-4">
                {method.icon}
                <p className="micro text-b60">{method.title}</p>
                <p className="text-sm text-ink break-all">{method.detail}</p>
              </div>
            ))}
          </div>

          <div className="pt-8 border-t border-b10">
            <p className="micro text-b60 mb-4">Follow Us</p>
            <div className="flex gap-6">
              <a href={shop.social.tiktok} target="_blank" rel="noopener noreferrer" className="text-ink hover:text-b60 transition-colors">
                <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24">
                  <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.04-.1z" />
                </svg>
              </a>
              <a href={shop.social.instagram} target="_blank" rel="noopener noreferrer" className="text-ink hover:text-b60 transition-colors">
                <Instagram className="w-6 h-6" />
              </a>
              <a href={shop.social.facebook} target="_blank" rel="noopener noreferrer" className="text-ink hover:text-b60 transition-colors">
                <Facebook className="w-6 h-6" />
              </a>
            </div>
          </div>
        </div>
      )
    },
    {
      title: "Shipping Information",
      icon: <Truck className="w-6 h-6 text-ink" />,
      content: (
        <div className="space-y-4 text-b60">
          <p>We deliver nationwide across South Africa. Door and locker delivery usually takes {shop.deliveryTime}.</p>
          <p>Options and fees are on our <Link to="/delivery" className={pageLink}>delivery page</Link>.</p>
        </div>
      )
    },
    {
      title: "Returns & Exchanges",
      icon: <RefreshCcw className="w-6 h-6 text-ink" />,
      content: (
        <div className="space-y-4 text-b60">
          <p>Not satisfied with your purchase? You can return or exchange items within {shop.returnDays} days of delivery.</p>
          <p>Conditions are on our <Link to="/returns" className={pageLink}>returns page</Link>.</p>
        </div>
      )
    },
    {
      title: "Size Guide",
      icon: <Ruler className="w-6 h-6 text-ink" />,
      content: (
        <p className="text-b60">
          Our sizes generally follow standard South African sizing. Measurements are on our <Link to="/size-guide" className={pageLink}>size guide</Link>.
        </p>
      )
    }
  ];

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-[1360px] mx-auto px-6 py-16">
        <header className="pb-12 mb-4 border-b border-b10">
          <p className="page-kicker micro text-b60 mb-6">Help</p>
          <h1 className="display h-sec mb-8">Customer service</h1>
          <p className="text-lg md:text-xl text-b60 max-w-2xl">Everything you need to know about shopping with us.</p>
        </header>

        {sections.map((section, idx) => (
          <section key={idx} className="grid md:grid-cols-[1fr_2fr] gap-8 md:gap-16 py-16 border-b border-b10">
            <div>
              <div className="flex items-center justify-between mb-6">
                <span className="text-sm text-brand">{String(idx + 1).padStart(2, "0")}</span>
                {section.icon}
              </div>
              <h2 className="display h-mid">{section.title}</h2>
            </div>
            <div>
              {section.content}
            </div>
          </section>
        ))}

        <section className="grid md:grid-cols-2 gap-8 items-end py-16">
          <div>
            <h2 className="display h-mid mb-4">Still have questions?</h2>
            <p className="text-b60">Our team is available {shop.hours}.</p>
          </div>
          <div className="md:justify-self-end">
            <a
              href={whatsappLink()}
              target="_blank"
              rel="noopener noreferrer"
              className="cta"
            >
              Chat on WhatsApp
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
