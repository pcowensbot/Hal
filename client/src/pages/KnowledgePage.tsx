import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BookList,
  NoteGrid,
  CreateBookModal,
  EditNoteModal,
  NoteViewModal,
  ImportBookModal,
  AutoOrganizeModal,
} from '../components/features/knowledge';
import { Avatar, ThemeToggle } from '../components/layout';
import { useLogout } from '../hooks';
import { useNotes, useSearchNotes, useBooks } from '../hooks/useKnowledge';
import { useAuthStore } from '../stores';
import { cn } from '../lib/utils';
import type { Book, StarredNote } from '../types';
import styles from './KnowledgePage.module.css';

export function KnowledgePage() {
  const navigate = useNavigate();
  const logout = useLogout();
  const user = useAuthStore((state) => state.user);

  // UI state
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [bookFilter, setBookFilter] = useState('');

  // Modal state
  const [createBookOpen, setCreateBookOpen] = useState(false);
  const [editBook, setEditBook] = useState<Book | null>(null);
  const [viewNote, setViewNote] = useState<StarredNote | null>(null);
  const [editNote, setEditNote] = useState<StarredNote | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [autoOrganizeOpen, setAutoOrganizeOpen] = useState(false);

  // Data
  const { data: books } = useBooks();
  const { data: allNotes, isLoading: notesLoading } = useNotes(selectedBookId || undefined);
  const { data: searchResults, isLoading: searchLoading } = useSearchNotes(searchQuery);

  // Determine which notes to display
  const displayNotes = useMemo(() => {
    if (searchQuery) {
      return searchResults;
    }
    if (bookFilter) {
      return allNotes?.filter((n) => n.bookId === bookFilter);
    }
    return allNotes;
  }, [searchQuery, searchResults, allNotes, bookFilter]);

  const isLoading = searchQuery ? searchLoading : notesLoading;

  // Handle search
  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const handleSearchKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setSearchQuery('');
    }
  };

  // Handle book selection
  const handleSelectBook = (bookId: string | null) => {
    setSelectedBookId(bookId);
    setSearchQuery('');
    setBookFilter('');
    setSidebarOpen(false);
  };

  // Handle edit book
  const handleEditBook = (book: Book) => {
    setEditBook(book);
    setCreateBookOpen(true);
  };

  // Handle view note (click on card)
  const handleViewNote = (note: StarredNote) => {
    setViewNote(note);
  };

  // Handle edit note (pencil icon)
  const handleEditNote = (note: StarredNote) => {
    setEditNote(note);
  };

  // Close create book modal
  const handleCloseCreateBook = () => {
    setCreateBookOpen(false);
    setEditBook(null);
  };

  // Get current book name for header
  const currentBookName = selectedBookId
    ? books?.find((b) => b.id === selectedBookId)?.name
    : 'All Notes';

  // Check if user has admin access
  const hasAdminAccess =
    user?.isSystemAdmin ||
    user?.permissions?.canManageUsers ||
    user?.permissions?.canManageGroups;

  return (
    <div className={styles.layout}>
      {/* Mobile backdrop */}
      <div
        className={cn(styles.backdrop, sidebarOpen && styles.visible)}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <aside className={cn(styles.sidebar, sidebarOpen && styles.open)}>
        <div className={styles.sidebarHeader}>
          <Link to="/chat" className={styles.logo}>
            HAL
          </Link>
          <div className={styles.headerActions}>
            <ThemeToggle />
          </div>
        </div>

        <div className={styles.navBar}>
          <Link to="/chat" className={styles.navIcon} title="Chat">
            {'\u{1F4AC}'}
          </Link>
          <Link to="/api" className={styles.navIcon} title="API">
            {'\u{26A1}'}
          </Link>
          {hasAdminAccess && (
            <Link to="/dashboard" className={styles.navIcon} title="Dashboard">
              {'\u{1F4CA}'}
            </Link>
          )}
          <div
            className={styles.navIcon}
            onClick={() => navigate('/profile')}
            title={user?.firstName || 'Profile'}
          >
            <Avatar src={user?.avatar} name={user?.firstName} size="sm" />
          </div>
          <div
            className={styles.navIcon}
            onClick={logout}
            title="Logout"
          >
            {'\u{1F6AA}'}
          </div>
        </div>

        <div className={styles.booksSection}>
          <BookList
            selectedBookId={selectedBookId}
            onSelectBook={handleSelectBook}
            onCreateBook={() => setCreateBookOpen(true)}
            onEditBook={handleEditBook}
            onImportBook={() => setImportOpen(true)}
          />
        </div>
      </aside>

      {/* Main content */}
      <main className={styles.main}>
        {/* Header */}
        <header className={styles.mainHeader}>
          <div className={styles.mainHeaderLeft}>
            <button
              className={styles.mobileMenuBtn}
              onClick={() => setSidebarOpen(true)}
            >
              {'\u{2630}'}
            </button>
            <h1 className={styles.mainTitle}>
              {'\u{1F4DA}'} {currentBookName}
            </h1>
          </div>
          <div className={styles.mainHeaderActions}>
          </div>
        </header>

        {/* Search bar */}
        <div className={styles.searchBar}>
          <div className={styles.searchInputWrapper}>
            <span className={styles.searchIcon}>{'\u{1F50D}'}</span>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search your knowledge base..."
              value={searchQuery}
              onChange={handleSearch}
              onKeyUp={handleSearchKeyUp}
            />
          </div>
          <select
            className={styles.bookFilter}
            value={bookFilter}
            onChange={(e) => setBookFilter(e.target.value)}
          >
            <option value="">All Books</option>
            {books?.map((book) => (
              <option key={book.id} value={book.id}>
                {book.name}
              </option>
            ))}
          </select>
        </div>

        {/* Notes content */}
        <div className={styles.content}>
          <NoteGrid
            notes={displayNotes}
            isLoading={isLoading}
            onViewNote={handleViewNote}
            onEditNote={handleEditNote}
            showBook={!selectedBookId && !bookFilter}
            emptyTitle={
              searchQuery
                ? 'No results found'
                : selectedBookId
                ? 'No notes in this book'
                : 'No notes yet'
            }
            emptyDescription={
              searchQuery
                ? 'Try a different search term'
                : 'Star messages from your chats to save them here. Organize them into books and share with friends!'
            }
          />
        </div>
      </main>

      {/* Modals */}
      <CreateBookModal
        isOpen={createBookOpen}
        onClose={handleCloseCreateBook}
        editBook={editBook}
      />

      <NoteViewModal
        isOpen={!!viewNote}
        onClose={() => setViewNote(null)}
        onEdit={() => {
          setEditNote(viewNote);
          setViewNote(null);
        }}
        note={viewNote}
      />

      <EditNoteModal
        isOpen={!!editNote}
        onClose={() => setEditNote(null)}
        note={editNote}
      />

      <ImportBookModal isOpen={importOpen} onClose={() => setImportOpen(false)} />

      <AutoOrganizeModal
        isOpen={autoOrganizeOpen}
        onClose={() => setAutoOrganizeOpen(false)}
      />
    </div>
  );
}
