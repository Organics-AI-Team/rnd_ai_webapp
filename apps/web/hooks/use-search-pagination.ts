"use client";

import { useState } from "react";
import type { SetStateAction } from "react";

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
  const [searchTerm, setSearchTermState] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortFieldState] = useState(defaultSortField);
  const [sortDirection, setSortDirectionState] = useState<"asc" | "desc">(defaultSortDirection);

  const setSearchTerm = (value: SetStateAction<string>) => {
    setSearchTermState(value);
    setCurrentPage(1);
  };

  const setSortField = (value: SetStateAction<string>) => {
    setSortFieldState(value);
    setCurrentPage(1);
  };

  const setSortDirection = (value: SetStateAction<"asc" | "desc">) => {
    setSortDirectionState(value);
    setCurrentPage(1);
  };

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
    setSearchTermState("");
    setCurrentPage(1);
  };

  const clearFilters = () => {
    setSearchInput("");
    setSearchTermState("");
    setSortFieldState(defaultSortField);
    setSortDirectionState(defaultSortDirection);
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
