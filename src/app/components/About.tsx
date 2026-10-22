import { Shirt, Users, Globe, Award } from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { GooArt } from "./prism/GooArt";

export function About() {
  const values = [
    {
      title: "Quality First",
      description: "We source only the finest fabrics and use rigorous manufacturing processes to ensure every garment meets our high standards.",
      icon: <Shirt className="w-6 h-6 text-ink" />
    },
    {
      title: "Community Focused",
      description: "Born in South Africa, we are proud to support local talent and contribute to our local community through various initiatives.",
      icon: <Users className="w-6 h-6 text-ink" />
    },
    {
      title: "Sustainability",
      description: "We are committed to reducing our environmental impact by using eco-friendly packaging and ethical sourcing.",
      icon: <Globe className="w-6 h-6 text-ink" />
    },
    {
      title: "Excellence",
      description: "Over 10 years of experience in the fashion industry, bringing you the latest trends with timeless quality.",
      icon: <Award className="w-6 h-6 text-ink" />
    }
  ];

  return (
    <div className="min-h-screen bg-paper">
      {/* Hero Section */}
      <section className="max-w-[1968px] mx-auto px-6 pt-16 pb-12">
        <p className="micro text-b60 mb-6">About</p>
        <h1 className="display h-sec mb-8">Our story</h1>
        <p className="text-lg md:text-xl text-b60 max-w-2xl">Crafting quality garments that inspire confidence and celebrate individuality since 2014.</p>
      </section>
      <div className="px-6">
        <div className="max-w-[1968px] mx-auto w-full aspect-[3/2] md:aspect-[3/1] overflow-hidden">
          <GooArt seed="about" cols={8} rows={4} variant="hero" />
        </div>
      </div>

      {/* Story Content */}
      <section className="max-w-[1968px] mx-auto px-6 py-16 border-b border-b10">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="display h-mid mb-6">How It All Started</h2>
            <div className="space-y-4 text-b60 leading-relaxed text-lg">
              <p>
                4Nguru The brand Online began with a simple vision: to make high-quality, stylish apparel accessible to everyone in South Africa. What started as a small local workshop has grown into a nationwide brand trusted by thousands.
              </p>
              <p>
                Our journey has been defined by a relentless pursuit of perfection. From the selection of raw materials to the final stitch, we pour our passion into every piece of clothing we create. We believe that what you wear is an extension of who you are, and we're here to help you express your best self.
              </p>
              <p>
                Today, we continue to innovate and expand our collections, always keeping our customers' needs at the heart of everything we do.
              </p>
            </div>
          </div>
          <div className="overflow-hidden border border-b10">
            <ImageWithFallback
              src="https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?auto=format&fit=crop&q=80&w=2070"
              alt="Our Workshop"
              className="w-full h-auto"
            />
          </div>
        </div>
      </section>

      {/* Values Section */}
      <section className="max-w-[1968px] mx-auto px-6 py-16 border-b border-b10">
        <div className="mb-16 max-w-2xl">
          <h2 className="display h-mid mb-4">Our Core Values</h2>
          <p className="text-b60">The principles that guide us in everything we do, from design to delivery.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-8">
          {values.map((value, index) => (
            <div key={index} className="border-t border-b10 py-8">
              <div className="flex items-center justify-between mb-8">
                <span className="font-mono text-sm text-prism">{String(index + 1).padStart(2, "0")}</span>
                {value.icon}
              </div>
              <h3 className="display text-2xl mb-3 text-ink">{value.title}</h3>
              <p className="text-b60 leading-relaxed">{value.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Call to Action */}
      <section className="max-w-[1968px] mx-auto px-6 py-16">
        <h2 className="display h-mid mb-6">Ready to find your style?</h2>
        <p className="text-lg md:text-xl text-b60 mb-10 max-w-2xl">Explore our latest collections and experience the quality for yourself.</p>
        <div className="flex flex-col sm:flex-row gap-6 sm:items-center">
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
