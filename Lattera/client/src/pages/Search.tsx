import { useState, useEffect, useCallback, useRef } from 'react';
import { Search as SearchIcon, Filter } from 'lucide-react';
import type { NavigateFn } from '../routes';
import type { ProfileCategory, UserSearchResult } from '../types/api';
import { api } from '../services/api';
import { useApp } from '../contexts/AppContext';
import { urlParams } from '../utils/urlParams';
import Logo from '../components/Logo';
import Button from '../components/ui/Button';
import SearchFilters from '../components/SearchFilters';
import UserCard from '../components/UserCard';

const DEBOUNCE_MS = 300;
const PAGE_SIZE = 12;

interface SearchState {
  category?: ProfileCategory;
  company?: string;
  skills?: string[];
  page: number;
}

export default function Search({ onNavigate }: { onNavigate: NavigateFn }) {
  const { addToast } = useApp();

  // State management
  const [filters, setFilters] = useState<SearchState>(() => {
    const params = urlParams.parse();
    return {
      category: params.category,
      company: params.company,
      skills: params.skills,
      page: params.page || 1,
    };
  });

  const [users, setUsers] = useState<UserSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [companyOptions, setCompanyOptions] = useState<string[]>([]);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout>();

  // Fetch companies for autocomplete
  const fetchCompanyOptions = useCallback(
    async (query: string) => {
      if (!query || query.length < 1) {
        setCompanyOptions([]);
        return;
      }

      try {
        const response = await api.users.searchUsers({
          company: query,
          limit: 5,
        });

        const uniqueCompanies = Array.from(
          new Set(response.users.map((user) => user.profile.company))
        );
        setCompanyOptions(uniqueCompanies);
      } catch {
        setCompanyOptions([]);
      }
    },
    []
  );

  // Fetch search results with debouncing
  const performSearch = useCallback(async (searchFilters: SearchState) => {
    setLoading(true);
    try {
      const offset = (searchFilters.page - 1) * PAGE_SIZE;
      const response = await api.users.searchUsers({
        category: searchFilters.category,
        company: searchFilters.company,
        skills: searchFilters.skills,
        limit: PAGE_SIZE,
        offset,
      });

      setUsers(response.users);
      setTotalCount(response.total);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Ошибка поиска';
      addToast('error', message);
      setUsers([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  // Debounced search effect
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      performSearch(filters);
      urlParams.update({
        category: filters.category,
        company: filters.company,
        skills: filters.skills,
        page: filters.page > 1 ? filters.page : undefined,
      });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [filters, performSearch]);

  const handleFiltersChange = useCallback(
    (newFilters: {
      category?: ProfileCategory;
      company?: string;
      skills?: string[];
    }) => {
      setFilters((prev) => ({
        ...prev,
        ...newFilters,
        page: 1,
      }));
      setShowMobileFilters(false);
    },
    []
  );

  const handleClearAllFilters = useCallback(() => {
    setFilters({
      category: undefined,
      company: undefined,
      skills: undefined,
      page: 1,
    });
    setCompanyOptions([]);
    urlParams.clear();
  }, []);

  const handleLoadMore = useCallback(() => {
    setFilters((prev) => ({
      ...prev,
      page: prev.page + 1,
    }));
  }, []);

  const handleChatCreated = useCallback(
    (chatId: string) => {
      onNavigate('/', { chatId });
    },
    [onNavigate]
  );

  const hasActiveFilters =
    filters.category || filters.company || (filters.skills && filters.skills.length > 0);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const hasMorePages = filters.page < totalPages;
  const isFirstPage = filters.page === 1;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F9FBFF] via-white to-[#F0F9FF]">
      {/* Header */}
      <header className="h-16 border-b border-[#E5E7EB] px-6 flex items-center justify-between bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <Logo size="sm" />
        <nav className="flex items-center gap-1">
          <button
            onClick={() => onNavigate('/')}
            className="px-4 py-2 text-[#6B7280] hover:bg-[#F3F4F6] rounded-lg font-medium transition-colors"
          >
            Чаты
          </button>
          <button
            onClick={() => onNavigate('/search')}
            className="px-4 py-2 text-[#2290FF] bg-[#F0F9FF] rounded-lg font-medium"
          >
            Поиск
          </button>
          <button
            onClick={() => onNavigate('/settings')}
            className="px-4 py-2 text-[#6B7280] hover:bg-[#F3F4F6] rounded-lg font-medium transition-colors"
          >
            Настройки
          </button>
        </nav>
      </header>

      {/* Mobile filters button */}
      <div className="lg:hidden sticky top-16 z-20 bg-white border-b border-[#E5E7EB] px-6 py-3">
        <button
          onClick={() => setShowMobileFilters(!showMobileFilters)}
          className="flex items-center gap-2 px-4 py-2 bg-[#F3F4F6] text-[#1A1A1A] rounded-lg font-medium hover:bg-[#E5E7EB] transition-colors"
        >
          <Filter size={18} />
          <span>Фильтры</span>
          {hasActiveFilters && (
            <span className="ml-2 px-2 py-1 bg-[#2290FF] text-white rounded-md text-xs font-semibold">
              {(filters.skills?.length || 0) + (filters.category ? 1 : 0) + (filters.company ? 1 : 0)}
            </span>
          )}
        </button>
      </div>

      {/* Main content */}
      <div className="max-w-7xl mx-auto p-6">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-[#1A1A1A] mb-2">
            Найти профессионала
          </h1>
          <p className="text-lg text-[#6B7280]">
            Используйте фильтры для поиска нужного специалиста
          </p>
        </div>

        {/* Desktop: Two column layout */}
        <div className="hidden lg:grid lg:grid-cols-[300px_1fr] gap-6">
          {/* Filters sidebar (desktop) */}
          <div>
            <SearchFilters
              category={filters.category}
              company={filters.company}
              skills={filters.skills}
              onFiltersChange={handleFiltersChange}
              companyOptions={companyOptions}
              onCompanyInputChange={fetchCompanyOptions}
              isMobile={false}
            />
          </div>

          {/* Results */}
          <div>
            <div className="mb-4">
              <p className="text-[#6B7280]">
                Найдено специалистов:{' '}
                <span className="font-semibold text-[#1A1A1A]">{totalCount}</span>
              </p>
            </div>

            {users.length > 0 ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                  {users.map((user) => (
                    <UserCard
                      key={user.id}
                      user={user}
                      onChatCreated={handleChatCreated}
                    />
                  ))}
                </div>

                {hasMorePages && (
                  <div className="flex justify-center">
                    <Button
                      variant="secondary"
                      onClick={handleLoadMore}
                      loading={loading}
                      className="px-8"
                    >
                      Загрузить ещё
                    </Button>
                  </div>
                )}

                {!hasMorePages && !isFirstPage && (
                  <p className="text-center text-[#6B7280] py-8">
                    Вы просмотрели все результаты
                  </p>
                )}
              </>
            ) : (
              <div className="text-center py-16">
                <div className="w-24 h-24 bg-[#F3F4F6] rounded-3xl flex items-center justify-center mx-auto mb-6">
                  <SearchIcon size={48} className="text-[#6B7280]" />
                </div>
                <h2 className="text-2xl font-bold text-[#1A1A1A] mb-2">
                  Ничего не найдено
                </h2>
                <p className="text-[#6B7280] mb-6">
                  Попробуйте изменить фильтры или сбросить их
                </p>
                {hasActiveFilters && (
                  <Button onClick={handleClearAllFilters} variant="secondary">
                    Сбросить фильтры
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Mobile: Stacked layout */}
        <div className="lg:hidden">
          {/* Mobile filters modal */}
          <SearchFilters
            category={filters.category}
            company={filters.company}
            skills={filters.skills}
            onFiltersChange={handleFiltersChange}
            companyOptions={companyOptions}
            onCompanyInputChange={fetchCompanyOptions}
            isOpen={showMobileFilters}
            onClose={() => setShowMobileFilters(false)}
            isMobile={true}
          />

          {/* Mobile results */}
          <div>
            <div className="mb-4">
              <p className="text-[#6B7280]">
                Найдено специалистов:{' '}
                <span className="font-semibold text-[#1A1A1A]">{totalCount}</span>
              </p>
            </div>

            {users.length > 0 ? (
              <>
                <div className="grid grid-cols-1 gap-6 mb-8">
                  {users.map((user) => (
                    <UserCard
                      key={user.id}
                      user={user}
                      onChatCreated={handleChatCreated}
                    />
                  ))}
                </div>

                {hasMorePages && (
                  <div className="flex justify-center">
                    <Button
                      variant="secondary"
                      onClick={handleLoadMore}
                      loading={loading}
                      className="px-8"
                    >
                      Загрузить ещё
                    </Button>
                  </div>
                )}

                {!hasMorePages && !isFirstPage && (
                  <p className="text-center text-[#6B7280] py-8">
                    Вы просмотрели все результаты
                  </p>
                )}
              </>
            ) : (
              <div className="text-center py-16">
                <div className="w-24 h-24 bg-[#F3F4F6] rounded-3xl flex items-center justify-center mx-auto mb-6">
                  <SearchIcon size={48} className="text-[#6B7280]" />
                </div>
                <h2 className="text-2xl font-bold text-[#1A1A1A] mb-2">
                  Ничего не найдено
                </h2>
                <p className="text-[#6B7280] mb-6">
                  Попробуйте изменить фильтры или сбросить их
                </p>
                {hasActiveFilters && (
                  <Button onClick={handleClearAllFilters} variant="secondary">
                    Сбросить фильтры
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
