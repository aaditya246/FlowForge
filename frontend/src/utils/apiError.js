export function getErrorMessage(err) {
  const apiError = err?.response?.data?.error;
  if (!apiError) return err?.message || 'Something went wrong';
  if (apiError.details) {
    const details = Array.isArray(apiError.details)
      ? apiError.details.map((d) => d.message || d).join('; ')
      : JSON.stringify(apiError.details);
    return `${apiError.message}: ${details}`;
  }
  return apiError.message;
}
