const values = [
  {
    title: "Quality First",
    text: "We care about quality, and we hold every garment to a high standard.",
  },
  {
    title: "Community Focused",
    text: "Born in South Africa, we are proud of where we come from and the community around us.",
  },
  {
    title: "Sustainability",
    text: "We want to reduce our environmental impact as we grow.",
  },
  {
    title: "Excellence",
    text: "We bring you the latest trends with timeless quality.",
  },
];

export function About() {
  return (
    <div className="min-h-screen bg-paper">
      {/* Hero Section */}
      <section className="mx-auto max-w-[1360px] px-4 pb-12 pt-16 sm:px-6">
        <p className="page-kicker micro mb-6 text-b60">About</p>
        <h1 className="display h-sec mb-8">Our story</h1>
        <p className="max-w-2xl text-lg text-b60 md:text-xl">
          Quality garments that inspire confidence and celebrate individuality.
        </p>
      </section>
      {/* Description */}
      <section className="mx-auto max-w-[1360px] border-b border-b10 px-4 py-16 sm:px-6">
        <h2 className="display h-mid mb-6">How it all started</h2>
        <div className="max-w-2xl space-y-4 text-lg leading-relaxed text-b60">
          <p>
            4Nguru The Brand Online began with a simple vision: to make high-quality, stylish apparel accessible to
            everyone in South Africa.
          </p>
          <p>
            We believe that what you wear is an extension of who you are, and we&apos;re here to help you express your
            best self.
          </p>
          <p>
            Today, we continue to expand our collections, always keeping our customers&apos; needs at the heart of
            everything we do.
          </p>
          <p>
            We sell T-shirts, jerseys, shorts, pants and accessories. You can order online, or start an order on
            WhatsApp.
          </p>
        </div>
      </section>

      {/* Values */}
      <section className="mx-auto max-w-[1360px] border-b border-b10 px-4 py-16 sm:px-6">
        <h2 className="display h-mid mb-6">Our core values</h2>
        <p className="mb-10 max-w-2xl text-lg text-b60">
          The principles that guide us in everything we do, from design to delivery.
        </p>
        <div className="grid gap-8 sm:grid-cols-2 max-w-4xl">
          {values.map((value) => (
            <div key={value.title}>
              <h3 className="display mb-2">{value.title}</h3>
              <p className="text-b60 leading-relaxed">{value.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Call to Action */}
      <section className="mx-auto max-w-[1360px] px-4 py-16 sm:px-6">
        <h2 className="display h-mid mb-6">Ready to find your style?</h2>
        <p className="mb-10 max-w-2xl text-lg text-b60 md:text-xl">
          Explore our latest collections and experience the quality for yourself.
        </p>
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
