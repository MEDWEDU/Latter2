import { useState, useEffect, useCallback } from 'react';
import { Search as SearchIcon, X, ChevronDown } from 'lucide-react';
import type { ProfileCategory } from '../types/api';
import Button from './ui/Button';

const CATEGORIES: ProfileCategory[] = ['IT', 'Marketing', 'Design', 'Finance', 'Other'];

interface SearchFiltersProps {
  category?: ProfileCategory;
  company?: string;
  skills?: string[];
  onFiltersChange?: (filters: {
    category?: ProfileCategory;
    company?: string;
    skills?: string[];
  }) => void;
  companyOptions?: string[];
  onCompanyInputChange?: (query: string) => void;
  isOpen?: boolean;
  onClose?: () => void;
  isMobile?: boolean;
}

export default function SearchFilters({
  category,
  company,
  skills = [],
  onFiltersChange,
  companyOptions = [],
  onCompanyInputChange,
  isOpen = true,
  onClose,
  isMobile = false,
}: SearchFiltersProps) {
  const [selectedCategory, setSelectedCategory] = useState<ProfileCategory | undefined>(
    category
  );
  const [companyFilter, setCompanyFilter] = useState(company || '');
  const [skillsFilter, setSkillsFilter] = useState<string[]>(skills);
  const [skillInput, setSkillInput] = useState('');
  const [showCompanyDropdown, setShowCompanyDropdown] = useState(false);

  const hasActiveFilters =
    selectedCategory || companyFilter || skillsFilter.length > 0;

  const handleCategoryChange = useCallback(
    (cat: ProfileCategory | undefined) => {
      setSelectedCategory(cat);
    },
    []
  );

  const handleCompanyChange = useCallback((value: string) => {
    setCompanyFilter(value);
    setShowCompanyDropdown(Boolean(value));
    onCompanyInputChange?.(value);
  }, [onCompanyInputChange]);

  const handleAddSkill = useCallback(() => {
    const trimmed = skillInput.trim();
    if (trimmed && !skillsFilter.includes(trimmed)) {
      setSkillsFilter([...skillsFilter, trimmed]);
      setSkillInput('');
    }
  }, [skillInput, skillsFilter]);

  const handleRemoveSkill = useCallback((skill: string) => {
    setSkillsFilter(skillsFilter.filter((s) => s !== skill));
  }, [skillsFilter]);

  const handleClearFilters = useCallback(() => {
    setSelectedCategory(undefined);
    setCompanyFilter('');
    setSkillsFilter([]);
    setSkillInput('');
    setShowCompanyDropdown(false);
  }, []);

  // Notify parent of filter changes
  useEffect(() => {
    onFiltersChange?.({
      category: selectedCategory,
      company: companyFilter || undefined,
      skills: skillsFilter.length > 0 ? skillsFilter : undefined,
    });
  }, [selectedCategory, companyFilter, skillsFilter, onFiltersChange]);

  const containerClasses = isMobile
    ? `fixed inset-0 z-40 bg-black/50 overflow-y-auto transition-opacity ${
        isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`
    : '';

  const contentClasses = isMobile
    ? 'fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl p-6 max-h-[90vh] overflow-y-auto transition-transform'
    : 'bg-white rounded-2xl shadow-lg shadow-blue-500/5 p-6';

  return (
    <>
      {isMobile && isOpen && (
        <div className={containerClasses} onClick={onClose} />
      )}
      <div className={contentClasses}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2 text-[#6B7280]">
            {isMobile && (
              <button
                onClick={onClose}
                className="text-[#1A1A1A] hover:bg-[#F3F4F6] p-2 rounded-lg transition-colors"
              >
                <ChevronDown size={24} />
              </button>
            )}
            <span className="font-medium">Фильтры</span>
          </div>
          {hasActiveFilters && (
            <button
              onClick={handleClearFilters}
              className="flex items-center gap-2 text-[#6B7280] hover:text-[#1A1A1A] transition-colors"
            >
              <X size={18} />
              <span className="text-sm font-medium">Сбросить</span>
            </button>
          )}
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-[#1A1A1A] mb-3">
              Категория
            </label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() =>
                    handleCategoryChange(selectedCategory === cat ? undefined : cat)
                  }
                  className={`px-4 py-2 rounded-xl font-medium transition-all ${
                    selectedCategory === cat
                      ? 'bg-[#2290FF] text-white shadow-lg shadow-blue-500/30'
                      : 'bg-[#F3F4F6] text-[#1A1A1A] hover:bg-[#E5E7EB]'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#1A1A1A] mb-3">
              Компания
            </label>
            <div className="relative">
              <SearchIcon
                size={20}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]"
              />
              <input
                type="text"
                placeholder="Google, Yandex, Freelance..."
                className="w-full h-12 pl-10 pr-4 rounded-xl border-2 border-[#E5E7EB] focus:border-[#2290FF] focus:outline-none transition-colors"
                value={companyFilter}
                onChange={(e) => handleCompanyChange(e.target.value)}
                onFocus={() => companyFilter && setShowCompanyDropdown(true)}
              />
              {showCompanyDropdown && companyOptions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white border-2 border-[#E5E7EB] rounded-xl shadow-lg z-10">
                  {companyOptions.map((option) => (
                    <button
                      key={option}
                      onClick={() => {
                        handleCompanyChange(option);
                        setShowCompanyDropdown(false);
                      }}
                      className="w-full text-left px-4 py-3 hover:bg-[#F3F4F6] transition-colors border-b border-[#E5E7EB] last:border-b-0"
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#1A1A1A] mb-3">
              Навыки
            </label>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                placeholder="Введите навык..."
                className="flex-1 h-12 px-4 rounded-xl border-2 border-[#E5E7EB] focus:border-[#2290FF] focus:outline-none transition-colors"
                value={skillInput}
                onChange={(e) => setSkillInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddSkill()}
              />
              <Button onClick={handleAddSkill} variant="secondary">
                Добавить
              </Button>
            </div>
            {skillsFilter.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {skillsFilter.map((skill) => (
                  <span
                    key={skill}
                    className="px-3 py-1.5 bg-[#F0F9FF] text-[#2290FF] rounded-lg text-sm font-medium flex items-center gap-2 border border-[#2290FF]/20"
                  >
                    {skill}
                    <button
                      onClick={() => handleRemoveSkill(skill)}
                      className="hover:text-[#EF4444] transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
