import { HelpCircle, Truck, RefreshCcw, Ruler, Mail, Phone, MessageSquare, Facebook, Instagram } from "lucide-react";

export function CustomerService() {
  const sections = [
    {
      title: "Contact Us",
      icon: <Mail className="w-6 h-6 text-blue-600" />,
      content: (
        <div className="space-y-4">
          <p>Have questions about your order or our products? We're here to help!</p>
          <div className="flex items-center gap-3">
            <Phone className="w-5 h-5 text-gray-500" />
            <span>+27 67 868 4428</span>
          </div>
          <div className="flex items-center gap-3">
            <MessageSquare className="w-5 h-5 text-gray-500" />
            <span>WhatsApp: +27 67 868 4428</span>
          </div>
          <div className="flex items-center gap-3">
            <Mail className="w-5 h-5 text-gray-500" />
            <span>malandela03@gmail.com</span>
          </div>
          
          <div className="pt-4 border-t border-gray-100">
            <p className="font-semibold text-gray-800 mb-3">Follow Us</p>
            <div className="flex gap-4">
              <a href="https://www.tiktok.com/@4nguru" target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-black transition-colors">
                <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24">
                  <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.04-.1z" />
                </svg>
              </a>
              <a href="https://www.instagram.com/4nguruthebrand" target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-pink-600 transition-colors">
                <Instagram className="w-6 h-6" />
              </a>
              <a href="https://www.facebook.com/p/4nguru-The-Brand-100063554708976/" target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-blue-600 transition-colors">
                <Facebook className="w-6 h-6" />
              </a>
            </div>
          </div>
        </div>
      )
    },
    {
      title: "Shipping Information",
      icon: <Truck className="w-6 h-6 text-green-600" />,
      content: (
        <div className="space-y-2">
          <p>We deliver nationwide across South Africa.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Standard Delivery: 3-5 working days (R100)</li>
            <li>Express Delivery: 1-2 working days (R150)</li>
            <li>Free delivery for orders over R1000</li>
          </ul>
        </div>
      )
    },
    {
      title: "Returns & Exchanges",
      icon: <RefreshCcw className="w-6 h-6 text-orange-600" />,
      content: (
        <div className="space-y-2">
          <p>Not satisfied with your purchase? You can return or exchange items within 30 days of delivery.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Items must be unworn and in original packaging</li>
            <li>Return shipping costs are the responsibility of the customer unless the item is faulty</li>
            <li>Exchanges are subject to stock availability</li>
          </ul>
        </div>
      )
    },
    {
      title: "Size Guide",
      icon: <Ruler className="w-6 h-6 text-purple-600" />,
      content: (
        <div className="space-y-2">
          <p>Our sizes generally follow standard South African sizing:</p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse border border-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="border border-gray-200 p-2">Size</th>
                  <th className="border border-gray-200 p-2">Chest (cm)</th>
                  <th className="border border-gray-200 p-2">Waist (cm)</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className="border border-gray-200 p-2">S</td><td className="border border-gray-200 p-2">91-96</td><td className="border border-gray-200 p-2">76-81</td></tr>
                <tr><td className="border border-gray-200 p-2">M</td><td className="border border-gray-200 p-2">97-102</td><td className="border border-gray-200 p-2">82-87</td></tr>
                <tr><td className="border border-gray-200 p-2">L</td><td className="border border-gray-200 p-2">103-108</td><td className="border border-gray-200 p-2">88-93</td></tr>
                <tr><td className="border border-gray-200 p-2">XL</td><td className="border border-gray-200 p-2">109-114</td><td className="border border-gray-200 p-2">94-99</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Customer Service</h1>
          <p className="text-lg text-gray-600">Everything you need to know about shopping with us.</p>
        </div>

        <div className="grid gap-8">
          {sections.map((section, idx) => (
            <div key={idx} className="bg-white rounded-xl shadow-sm p-6 md:p-8">
              <div className="flex items-center gap-4 mb-6">
                <div className="p-3 bg-gray-50 rounded-lg">
                  {section.icon}
                </div>
                <h2 className="text-2xl font-semibold text-gray-800">{section.title}</h2>
              </div>
              <div className="text-gray-600">
                {section.content}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 bg-blue-600 rounded-xl p-8 text-white text-center">
          <h3 className="text-2xl font-bold mb-4">Still have questions?</h3>
          <p className="mb-6 opacity-90">Our team is available Monday to Friday, 9am - 5pm.</p>
          <a 
            href="https://wa.me/27678684428" 
            target="_blank" 
            rel="noopener noreferrer"
            className="inline-block bg-white text-blue-600 px-8 py-3 rounded-full font-bold hover:bg-gray-100 transition-colors"
          >
            Chat on WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}
