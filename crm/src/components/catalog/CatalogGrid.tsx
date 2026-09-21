import React, { useState, useEffect } from 'react';
import { Jersey } from '../../types/crm.types.js';
import { crmApi } from '../../services/api.js';
import { Search, Filter, Check, Edit2 } from 'lucide-react';

export const CatalogGrid: React.FC = () => {
  const [jerseys, setJerseys] = useState<Jersey[]>([]);
  const [search, setSearch] = useState('');
  const [selectedLeague, setSelectedLeague] = useState('All');
  const [isLoading, setIsLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState<string>('');

  useEffect(() => {
    loadCatalog();
  }, [selectedLeague]);

  const loadCatalog = async () => {
    try {
      setIsLoading(true);
      const leagueParam = selectedLeague === 'All' ? undefined : selectedLeague;
      const data = await crmApi.getCatalog(search, leagueParam);
      setJerseys(data);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSavePrice = async (jersey: Jersey) => {
    const newPrice = Number(editPrice);
    if (isNaN(newPrice) || newPrice < 0) return;

    try {
      await crmApi.updateJersey(jersey.id, { basePrice: newPrice });
      setJerseys((prev) =>
        prev.map((j) => (j.id === jersey.id ? { ...j, basePrice: newPrice } : j))
      );
      setEditingId(null);
    } catch (error) {
      console.error('Failed to update price:', error);
    }
  };

  const leagues = ['All', 'Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1', 'National Teams'];

  return (
    <div className="flex-1 bg-slate-950 flex flex-col overflow-y-auto">
      {/* Catalog Header & Controls */}
      <div className="p-6 border-b border-slate-800 bg-slate-900/60 sticky top-0 z-10 backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-bold text-lg text-white">Jersey Catalog & Inventory</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Manage product pricing, leagues, and size availability
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search team or kit..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadCatalog()}
                className="w-56 bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* League Dropdown */}
            <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={selectedLeague}
                onChange={(e) => setSelectedLeague(e.target.value)}
                className="bg-transparent border-none text-xs text-slate-200 focus:outline-none"
              >
                {leagues.map((l) => (
                  <option key={l} value={l} className="bg-slate-900 text-white">
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Catalog Grid */}
      <div className="p-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
        {isLoading && (
          <div className="col-span-full py-20 text-center text-xs text-slate-400">
            Loading kits catalog...
          </div>
        )}

        {!isLoading && jerseys.length === 0 && (
          <div className="col-span-full py-20 text-center text-xs text-slate-500">
            No jerseys found in the catalog matching your filters.
          </div>
        )}

        {jerseys.map((jersey) => (
          <div
            key={jersey.id}
            className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden hover:border-slate-700 transition-all shadow-md flex flex-col"
          >
            {/* Jersey Card Image */}
            <div className="relative h-48 bg-slate-950 overflow-hidden group">
              <img
                src={jersey.imageUrl}
                alt={jersey.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
              <span className="absolute top-2.5 left-2.5 bg-slate-900/90 border border-slate-700 text-slate-200 text-[10px] font-semibold px-2 py-0.5 rounded-md">
                {jersey.kitType}
              </span>
              <span className="absolute top-2.5 right-2.5 bg-emerald-950/90 border border-emerald-700 text-emerald-400 text-[10px] font-semibold px-2 py-0.5 rounded-md">
                {jersey.season}
              </span>
            </div>

            {/* Jersey Card Content */}
            <div className="p-4 flex-1 flex flex-col justify-between">
              <div>
                <p className="text-[11px] text-slate-400 font-medium">{jersey.league}</p>
                <h3 className="font-bold text-sm text-white mt-0.5 leading-snug line-clamp-2">
                  {jersey.title}
                </h3>
              </div>

              {/* Price & Inventory Details */}
              <div className="mt-4 pt-3 border-t border-slate-800/80">
                {/* Price Display / Edit */}
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-slate-400">Base Price:</span>
                  {editingId === jersey.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        className="w-20 bg-slate-950 border border-emerald-500 rounded px-1.5 py-0.5 text-xs text-white"
                        autoFocus
                      />
                      <button
                        onClick={() => handleSavePrice(jersey)}
                        className="p-1 text-emerald-400 hover:text-emerald-300"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div
                      onClick={() => {
                        setEditingId(jersey.id);
                        setEditPrice(String(jersey.basePrice));
                      }}
                      className="flex items-center gap-1.5 cursor-pointer group"
                    >
                      <span className="font-mono text-sm font-bold text-emerald-400">
                        ₦{jersey.basePrice.toLocaleString()}
                      </span>
                      <Edit2 className="w-3 h-3 text-slate-500 group-hover:text-slate-300" />
                    </div>
                  )}
                </div>

                {/* Size-Level Inventory Pills */}
                <div>
                  <div className="text-[11px] text-slate-400 mb-1.5 font-medium">Physical Stock:</div>
                  <div className="flex flex-wrap gap-1">
                    {jersey.inventory?.map((inv) => {
                      const isAvailable = inv.quantityAvailable > 0;
                      return (
                        <span
                          key={inv.size}
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                            isAvailable
                              ? 'bg-slate-950 text-slate-200 border-slate-700'
                              : 'bg-red-950/40 text-red-400 border-red-900/60 opacity-60'
                          }`}
                          title={`${inv.quantityOnHand} on hand, ${inv.quantityReserved} reserved`}
                        >
                          {inv.size}: {inv.quantityAvailable}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
