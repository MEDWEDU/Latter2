export type Route =
  | '/auth/signup'
  | '/auth/verify-email'
  | '/onboarding/profile'
  | '/'
  | '/search'
  | '/settings';

export interface RouteData {
  email?: string;
  password?: string;
  chatId?: string;
}

export type NavigateFn = (path: Route, data?: RouteData) => void;
