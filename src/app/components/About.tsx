import { GooArt } from "./prism/GooArt";

export function About() {
  return (
    <div className="min-h-screen bg-paper">
      {/* Hero Section */}
      <section className="mx-auto max-w-[1968px] px-4 pb-12 pt-16 sm:px-6">
        <p className="micro mb-6 text-b60">About</p>
        <h1 className="display h-sec mb-8">Our story</h1>
        <p className="max-w-2xl text-lg text-b60 md:text-xl">
          A South African clothing brand selling T-shirts, jerseys, shorts, pants and accessories, ordered online or on WhatsApp.
        </p>
      </section>
      <div className="px-4 sm:px-6">
        <div className="mx-auto aspect-[3/2] w-full max-w-[1968px] overflow-hidden md:aspect-[3/1]">
          <GooArt seed="about" cols={8} rows={4} variant="hero" />
        </div>
      </div>

      {/* Description */}
      <section className="mx-auto max-w-[1968px] border-b border-b10 px-4 py-16 sm:px-6">
        <h2 className="display h-mid mb-6">What we sell</h2>
        <div className="max-w-2xl space-y-4 text-lg leading-relaxed text-b60">
          <p>
            4Nguru The Brand Online is a South African clothing brand. We sell T-shirts, jerseys, shorts, pants and
            accessories.
          </p>
          <p>You can order online, or start an order on WhatsApp.</p>
        </div>
      </section>

      {/* Call to Action */}
      <section className="mx-auto max-w-[1968px] px-4 py-16 sm:px-6">
        <h2 className="display h-mid mb-6">Ready to find your style?</h2>
        <p className="mb-10 max-w-2xl text-lg text-b60 md:text-xl">Browse the collections and order online or on WhatsApp.</p>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <a href="/tshirts" className="cta">
            Shop T-Shirts
          </a>
          <a href="/jerseys" className="linkr text-ink">
            Browse Jerseys
          </a>
        </div>
      </section>
    </div>
  );
}
