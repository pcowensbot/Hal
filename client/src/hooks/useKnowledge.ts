import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { knowledgeApi } from '../lib/api';
import type { Book, StarredNote } from '../types';

// Query keys
export const knowledgeKeys = {
  all: ['knowledge'] as const,
  books: () => [...knowledgeKeys.all, 'books'] as const,
  book: (id: string) => [...knowledgeKeys.all, 'book', id] as const,
  notes: (bookId?: string) => [...knowledgeKeys.all, 'notes', bookId] as const,
  search: (query: string) => [...knowledgeKeys.all, 'search', query] as const,
};

// Fetch all books
export function useBooks() {
  return useQuery({
    queryKey: knowledgeKeys.books(),
    queryFn: knowledgeApi.getBooks,
  });
}

// Fetch single book with notes
export function useBook(id: string | undefined) {
  return useQuery({
    queryKey: knowledgeKeys.book(id!),
    queryFn: () => knowledgeApi.getBook(id!),
    enabled: !!id,
  });
}

// Fetch notes (optionally filtered by book)
export function useNotes(bookId?: string) {
  return useQuery({
    queryKey: knowledgeKeys.notes(bookId),
    queryFn: () => knowledgeApi.getNotes(bookId),
  });
}

// Search notes
export function useSearchNotes(query: string) {
  return useQuery({
    queryKey: knowledgeKeys.search(query),
    queryFn: () => knowledgeApi.search(query),
    enabled: query.length > 0,
  });
}

// Create book
export function useCreateBook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ name, description }: { name: string; description?: string }) =>
      knowledgeApi.createBook(name, description),
    onSuccess: (newBook) => {
      queryClient.setQueryData<Book[]>(
        knowledgeKeys.books(),
        (old) => old ? [...old, newBook] : [newBook]
      );
    },
  });
}

// Update book
export function useUpdateBook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      name?: string;
      description?: string;
    }) => knowledgeApi.updateBook(id, data),
    onSuccess: (updated, { id }) => {
      queryClient.setQueryData<Book[]>(
        knowledgeKeys.books(),
        (old) => old?.map((b) => (b.id === id ? { ...b, ...updated } : b))
      );
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.book(id) });
    },
  });
}

// Delete book
export function useDeleteBook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => knowledgeApi.deleteBook(id),
    onSuccess: (_, id) => {
      queryClient.setQueryData<Book[]>(
        knowledgeKeys.books(),
        (old) => old?.filter((b) => b.id !== id)
      );
      queryClient.removeQueries({ queryKey: knowledgeKeys.book(id) });
    },
  });
}

// Create note (star a message)
export function useCreateNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      messageId,
      bookId,
      title,
      note,
    }: {
      messageId: string;
      bookId?: string;
      title?: string;
      note?: string;
    }) => knowledgeApi.createNote(messageId, bookId, title, note),
    onSuccess: (_newNote, { bookId }) => {
      // Invalidate notes queries
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.notes() });
      if (bookId) {
        queryClient.invalidateQueries({ queryKey: knowledgeKeys.book(bookId) });
      }
    },
  });
}

// Update note
export function useUpdateNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      title?: string;
      note?: string;
      bookId?: string;
    }) => knowledgeApi.updateNote(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
    },
  });
}

// Delete note
export function useDeleteNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => knowledgeApi.deleteNote(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
    },
  });
}

// Create note from text (for artifacts — no message required)
export function useCreateNoteFromText() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      content,
      title,
      bookId,
    }: {
      content: string;
      title?: string;
      bookId?: string;
    }) => knowledgeApi.createNoteFromText(content, title, bookId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
    },
  });
}

// Auto-organize notes
export function useAutoOrganize() {
  return useMutation({
    mutationFn: (noteIds: string[]) => knowledgeApi.autoOrganize(noteIds),
  });
}

// Export book
export function useExportBook() {
  return useMutation({
    mutationFn: (id: string) => knowledgeApi.exportBook(id),
  });
}

// Import book
export function useImportBook() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { book: Partial<Book>; notes: Partial<StarredNote>[] }) =>
      knowledgeApi.importBook(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
    },
  });
}
