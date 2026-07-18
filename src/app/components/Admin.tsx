import { useState, useEffect } from "react";
import { getProducts, addProduct, updateProduct, deleteProduct, Product } from "../utils/storage";
import { Plus, Edit, Trash2, Save, X, Lock } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { toast } from "sonner";

const ADMIN_PASSWORD = "admin123"; // Change this to your desired password

export function Admin() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [formData, setFormData] = useState<Partial<Product>>({
    name: '',
    category: 'tshirts',
    price: 0,
    description: '',
    image: '',
    images: ['', '', ''],
    sizes: ['S', 'M', 'L', 'XL'],
    colors: ['Black', 'White'],
    stock: 0
  });
  const [imagePreviews, setImagePreviews] = useState<string[]>(['', '', '']);

  useEffect(() => {
    const savedAuth = sessionStorage.getItem('admin_authenticated');
    if (savedAuth === 'true') {
      setIsAuthenticated(true);
    }
  }, []);

  useEffect(() => {
    refreshProducts();
  }, []);

  const refreshProducts = () => {
    setProducts(getProducts());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (editing) {
      updateProduct(editing, { ...formData, image: formData.images?.[0] || '' });
      toast.success('Product updated successfully');
      setEditing(null);
    } else {
      addProduct({ ...formData, image: formData.images?.[0] || '' } as Omit<Product, 'id'>);
      toast.success('Product added successfully');
      setAdding(false);
    }

    setFormData({
      name: '',
      category: 'tshirts',
      price: 0,
      description: '',
      image: '',
      images: ['', '', ''],
      sizes: ['S', 'M', 'L', 'XL'],
      colors: ['Black', 'White'],
      stock: 0
    });
    setImagePreviews(['', '', '']);

    refreshProducts();
  };

  const handleEdit = (product: Product) => {
    setEditing(product.id);
    const images = product.images || [product.image, '', ''];
    // Ensure we always have 3 slots
    while (images.length < 3) images.push('');
    const fullProduct = { ...product, images };
    setFormData(fullProduct);
    setImagePreviews(images);
    setAdding(false);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        toast.error('Image size should be less than 2MB');
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        const newImages = [...(formData.images || ['', '', ''])];
        newImages[index] = base64String;
        setFormData({ ...formData, images: newImages });
        
        const newPreviews = [...imagePreviews];
        newPreviews[index] = base64String;
        setImagePreviews(newPreviews);
        
        toast.success(`Image ${index + 1} uploaded successfully`);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCancel = () => {
    setEditing(null);
    setAdding(false);
    setImagePreviews(['', '', '']);
    setFormData({
      name: '',
      category: 'tshirts',
      price: 0,
      description: '',
      image: '',
      images: ['', '', ''],
      sizes: ['S', 'M', 'L', 'XL'],
      colors: ['Black', 'White'],
      stock: 0
    });
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput === ADMIN_PASSWORD) {
      setIsAuthenticated(true);
      sessionStorage.setItem('admin_authenticated', 'true');
      setPasswordInput('');
      toast.success('Welcome to Admin Panel');
    } else {
      toast.error('Incorrect password');
      setPasswordInput('');
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    sessionStorage.removeItem('admin_authenticated');
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-lg shadow-lg p-8">
            <div className="text-center mb-8">
              <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                <Lock className="w-8 h-8 text-blue-600" />
              </div>
              <h2 className="text-3xl">Admin Login</h2>
              <p className="text-gray-600 mt-2">Enter password to access admin panel</p>
            </div>
            <form onSubmit={handleLogin}>
              <div className="mb-6">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Enter admin password"
                  required
                  autoFocus
                />
              </div>
              <Button type="submit" className="w-full">
                Login
              </Button>
            </form>
            <p className="text-xs text-gray-500 text-center mt-4">
              Default password: admin123
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl">Admin Panel</h1>
          <div className="flex gap-2">
            <Button onClick={() => setAdding(true)} disabled={adding || editing !== null}>
              <Plus className="w-4 h-4 mr-2" />
              Add Product
            </Button>
            <Button onClick={handleLogout} variant="outline">
              Logout
            </Button>
          </div>
        </div>

        {/* Add/Edit Form */}
        {(adding || editing) && (
          <div className="bg-white rounded-lg shadow p-6 mb-8">
            <h2 className="text-xl mb-4">{editing ? 'Edit Product' : 'Add New Product'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="name">Product Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="category">Category</Label>
                  <Select
                    value={formData.category}
                    onValueChange={(value) => setFormData({ ...formData, category: value as Product['category'] })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tshirts">T-Shirts</SelectItem>
                      <SelectItem value="jerseys">Jerseys</SelectItem>
                      <SelectItem value="shorts">Shorts</SelectItem>
                      <SelectItem value="pants">Pants</SelectItem>
                      <SelectItem value="accessories">Accessories</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="price">Price (R)</Label>
                  <Input
                    id="price"
                    type="number"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) })}
                    required
                    min="0"
                    step="0.01"
                  />
                </div>
                <div>
                  <Label htmlFor="stock">Stock</Label>
                  <Input
                    id="stock"
                    type="number"
                    value={formData.stock}
                    onChange={(e) => setFormData({ ...formData, stock: parseInt(e.target.value) })}
                    required
                    min="0"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    required
                  />
                </div>
                <div className="md:col-span-2">
                  <div className="flex justify-between items-end mb-1">
                    <Label>Product Images (Max 3)</Label>
                    <span className="text-[10px] text-orange-600 bg-orange-50 px-2 py-0.5 rounded border border-orange-100">
                      Tip: Use small images or URLs to avoid storage limits
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
                    {[0, 1, 2].map((index) => (
                      <div key={index} className="space-y-2">
                        <Label htmlFor={`image-${index}`} className="text-xs text-gray-500">
                          Image {index + 1} {index === 0 && '(Main)'}
                        </Label>
                        <div className="flex flex-col gap-2">
                          <Input
                            id={`imageFile-${index}`}
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleImageUpload(e, index)}
                            className="text-xs"
                          />
                          <Input
                            value={formData.images?.[index]?.startsWith('data:') ? '' : formData.images?.[index]}
                            onChange={(e) => {
                              const newImages = [...(formData.images || ['', '', ''])];
                              newImages[index] = e.target.value;
                              setFormData({ ...formData, images: newImages });
                              const newPreviews = [...imagePreviews];
                              newPreviews[index] = e.target.value;
                              setImagePreviews(newPreviews);
                            }}
                            placeholder="Or image URL"
                            className="text-xs"
                          />
                          {imagePreviews[index] && (
                            <div className="aspect-square border rounded overflow-hidden bg-gray-100 relative group">
                              <img
                                src={imagePreviews[index]}
                                alt={`Preview ${index + 1}`}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="128" height="128"%3E%3Crect fill="%23e5e7eb" width="128" height="128"/%3E%3C/svg%3E';
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const newImages = [...(formData.images || ['', '', ''])];
                                  newImages[index] = '';
                                  setFormData({ ...formData, images: newImages });
                                  const newPreviews = [...imagePreviews];
                                  newPreviews[index] = '';
                                  setImagePreviews(newPreviews);
                                }}
                                className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <Label htmlFor="sizes">Sizes (comma-separated)</Label>
                  <Input
                    id="sizes"
                    value={formData.sizes?.join(', ')}
                    onChange={(e) => setFormData({
                      ...formData,
                      sizes: e.target.value.split(',').map(s => s.trim()).filter(s => s)
                    })}
                    placeholder="S, M, L, XL"
                  />
                </div>
                <div>
                  <Label htmlFor="colors">Colors (comma-separated)</Label>
                  <Input
                    id="colors"
                    value={formData.colors?.join(', ')}
                    onChange={(e) => setFormData({
                      ...formData,
                      colors: e.target.value.split(',').map(c => c.trim()).filter(c => c)
                    })}
                    placeholder="Black, White, Blue"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit">
                  <Save className="w-4 h-4 mr-2" />
                  Save Product
                </Button>
                <Button type="button" variant="outline" onClick={handleCancel}>
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* Products List */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider">Product</th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider">Category</th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider">Price</th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider">Stock</th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {products.map((product) => (
                <tr key={product.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <img
                        src={product.image}
                        alt={product.name}
                        className="w-10 h-10 rounded object-cover"
                        onError={(e) => {
                          e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40"%3E%3Crect fill="%23e5e7eb" width="40" height="40"/%3E%3C/svg%3E';
                        }}
                      />
                      <div className="ml-4">
                        <div>{product.name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap capitalize">{product.category}</td>
                  <td className="px-6 py-4 whitespace-nowrap">R{product.price}</td>
                  <td className="px-6 py-4 whitespace-nowrap">{product.stock}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEdit(product)}
                        className="text-blue-600 hover:text-blue-700"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(product.id, product.name)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
