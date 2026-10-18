"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { ProductSearchHit } from "@/lib/product-search";

/**
 * Product picker backed by `/api/products/search` (barcode + FTS). Type at
 * least 2 characters or paste/scan a full barcode; choose a hit to emit it.
 * Keyboard-complete: arrows move the highlight, Enter picks, Escape closes.
 */
export function ProductCombobox({
  onSelect,
  placeholder = "Scan a barcode or search name / generic / SKU…",
  disabled = false,
  autoFocus = false,
}: {
  onSelect: (product: ProductSearchHit) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const { data } = useQuery({
    queryKey: ["product-search", debounced],
    enabled: debounced.length >= 2,
    queryFn: async () => {
      const response = await fetch(`/api/products/search?q=${encodeURIComponent(debounced)}`);
      if (!response.ok) throw new Error("Search failed");
      return (await response.json()) as { products: ProductSearchHit[] };
    },
  });
  const hits = data?.products ?? [];

  function pick(product: ProductSearchHit) {
    setQuery(product.name);
    setOpen(false);
    onSelect(product);
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={query}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlight((h) => Math.min(h + 1, hits.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (event.key === "Enter" && open && hits[highlight]) {
            event.preventDefault();
            pick(hits[highlight]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && hits.length > 0 ? (
        <ul className="bg-popover text-popover-foreground absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border p-1 shadow-md">
          {hits.map((product, index) => (
            <li key={product.id}>
              <button
                type="button"
                className={`flex w-full flex-col gap-0.5 rounded-sm px-2 py-1.5 text-left text-sm ${
                  index === highlight ? "bg-accent" : "hover:bg-accent/60"
                }`}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => pick(product)}
              >
                <span className="flex items-center gap-2">
                  <span className="font-medium">{product.name}</span>
                  {product.requiresRx ? <Badge variant="secondary">Rx</Badge> : null}
                  {product.controlledSchedule ? (
                    <Badge variant="destructive">{product.controlledSchedule}</Badge>
                  ) : null}
                  {product.matchedBarcode ? (
                    <Badge variant="outline">barcode {product.matchedBarcode}</Badge>
                  ) : null}
                </span>
                <span className="text-muted-foreground text-xs">
                  {product.genericName ?? product.sku} · stock {product.stockBase}{" "}
                  {product.baseUnit}
                  {product.stockBase === 1 ? "" : "s"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
