import { Form } from "react-router";
import { ArrowRight, Search } from "lucide-react";

/**
 * Search box for the shop. Controlled when onValueChange is given (the page filters as you type);
 * otherwise it submits a GET form to /shop?q=..., which works without JavaScript.
 */
export function ProductSearch({
  value,
  onValueChange,
  placeholder = "Search products",
}: {
  value?: string;
  onValueChange?: (next: string) => void;
  placeholder?: string;
}) {
  return (
    <Form
      action="/shop"
      method="get"
      role="search"
      className="product-search flex items-center"
      onSubmit={onValueChange ? (e) => e.preventDefault() : undefined}
    >
      <div className="product-search-field flex flex-1 items-center gap-2">
        <Search className="h-5 w-5 shrink-0" aria-hidden="true" />
        <input
          type="search"
          name="q"
          aria-label="Search products"
          placeholder={placeholder}
          className="product-search-input"
          autoComplete="off"
          value={onValueChange ? (value ?? "") : undefined}
          onChange={onValueChange ? (e) => onValueChange(e.target.value) : undefined}
        />
      </div>
      <button type="submit" aria-label="Search" className="product-search-go">
        <ArrowRight className="h-5 w-5" aria-hidden="true" />
      </button>
    </Form>
  );
}
