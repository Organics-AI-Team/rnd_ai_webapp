"use client";

import { useState, useEffect } from "react";

interface UseSearchPaginationOptions {
  itemsPerPage?: number;
  defaultSortField?: string;
  defaultSortDirection?: "asc" | "desc";
}

export function useSearchPagination({
  itemsPerPage = 50,
  defaultSortField = "productCode",
  defaultSortDirection = "asc"
}: UseSearchPaginationOptions = {}) {
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState(defaultSortField);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">(defaultSortDirection);

  // Reset to page 1 when search term, sort field, or sort direction changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, sortField, sortDirection]);

  const handleSearch = () => {
    setSearchTerm(searchInput);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  const resetPagination = () => setCurrentPage(1);

  const resetSearch = () => {
    setSearchInput("");
    setSearchTerm("");
    setCurrentPage(1);
  };

  const clearFilters = () => {
    setSearchInput("");
    setSearchTerm("");
    setSortField(defaultSortField);
    setSortDirection(defaultSortDirection);
    setCurrentPage(1);
  };

  return {
    // State
    searchInput,
    searchTerm,
    currentPage,
    sortField,
    sortDirection,
    itemsPerPage,

    // Actions
    setSearchInput,
    setSearchTerm,
    setCurrentPage,
    setSortField,
    setSortDirection,
    handleSearch,
    handleKeyPress,
    resetPagination,
    resetSearch,
    clearFilters
  };
}