import type { ProfileCategory } from '../types/api';

export interface SearchFilters {
  category?: ProfileCategory;
  company?: string;
  skills?: string[];
  page?: number;
}

export const urlParams = {
  parse(): SearchFilters {
    if (typeof window === 'undefined') {
      return {};
    }

    const params = new URLSearchParams(window.location.search);
    const filters: SearchFilters = {};

    const category = params.get('category');
    if (category) {
      filters.category = category as ProfileCategory;
    }

    const company = params.get('company');
    if (company) {
      filters.company = company;
    }

    const skills = params.get('skills');
    if (skills) {
      filters.skills = skills.split(',').filter(Boolean);
    }

    const page = params.get('page');
    if (page) {
      filters.page = Math.max(1, parseInt(page, 10));
    }

    return filters;
  },

  update(filters: SearchFilters): void {
    if (typeof window === 'undefined') {
      return;
    }

    const params = new URLSearchParams();

    if (filters.category) {
      params.set('category', filters.category);
    }

    if (filters.company) {
      params.set('company', filters.company);
    }

    if (filters.skills && filters.skills.length > 0) {
      params.set('skills', filters.skills.join(','));
    }

    if (filters.page && filters.page > 1) {
      params.set('page', String(filters.page));
    }

    const queryString = params.toString();
    const newUrl = queryString
      ? `${window.location.pathname}?${queryString}`
      : window.location.pathname;

    window.history.replaceState(null, '', newUrl);
  },

  clear(): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.history.replaceState(null, '', window.location.pathname);
  },
};
