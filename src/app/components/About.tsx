import { Shirt, Users, Globe, Award } from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";

export function About() {
  const values = [
    {
      title: "Quality First",
      description: "We source only the finest fabrics and use rigorous manufacturing processes to ensure every garment meets our high standards.",
      icon: <Shirt className="w-8 h-8 text-blue-500" />
    },
    {
      title: "Community Focused",
      description: "Born in South Africa, we are proud to support local talent and contribute to our local community through various initiatives.",
      icon: <Users className="w-8 h-8 text-green-500" />
    },
    {
      title: "Sustainability",
      description: "We are committed to reducing our environmental impact by using eco-friendly packaging and ethical sourcing.",
      icon: <Globe className="w-8 h-8 text-emerald-500" />
    },
    {
      title: "Excellence",
      description: "Over 10 years of experience in the fashion industry, bringing you the latest trends with timeless quality.",
      icon: <Award className="w-8 h-8 text-yellow-500" />
    }
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <section className="relative h-[400px] flex items-center justify-center">
        <div className="absolute inset-0 z-0">
          <ImageWithFallback
            src="https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&q=80&w=2070"
            alt="About Us Background"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-black/50" />
        </div>
        <div className="relative z-10 text-center text-white px-4">
          <h1 className="text-5xl font-bold mb-4">Our Story</h1>
          <p className="text-xl max-w-2xl mx-auto">Crafting quality garments that inspire confidence and celebrate individuality since 2014.</p>
        </div>
      </section>

      {/* Story Content */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold mb-6 text-gray-900">How It All Started</h2>
              <div className="space-y-4 text-gray-600 leading-relaxed text-lg">
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
            <div className="rounded-2xl overflow-hidden shadow-2xl">
              <ImageWithFallback
                src="https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?auto=format&fit=crop&q=80&w=2070"
                alt="Our Workshop"
                className="w-full h-auto"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Values Section */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Our Core Values</h2>
            <p className="text-gray-600 max-w-2xl mx-auto">The principles that guide us in everything we do, from design to delivery.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {values.map((value, index) => (
              <div key={index} className="bg-white p-8 rounded-xl shadow-sm hover:shadow-md transition-shadow">
                <div className="mb-4">{value.icon}</div>
                <h3 className="text-xl font-bold mb-2 text-gray-900">{value.title}</h3>
                <p className="text-gray-600 leading-relaxed">{value.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Call to Action */}
      <section className="py-20 text-center">
        <div className="max-w-4xl mx-auto px-4">
          <h2 className="text-3xl font-bold mb-6">Ready to find your style?</h2>
          <p className="text-xl text-gray-600 mb-10">Explore our latest collections and experience the quality for yourself.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a href="/tshirts" className="bg-blue-600 text-white px-8 py-3 rounded-lg font-bold hover:bg-blue-700 transition-colors">
              Shop T-Shirts
            </a>
            <a href="/jerseys" className="bg-gray-900 text-white px-8 py-3 rounded-lg font-bold hover:bg-gray-800 transition-colors">
              Browse Jerseys
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
