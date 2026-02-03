const TMDB_API_KEY = process.env.TMDB_API_KEY;

export async function searchMoviesAndTV(ageRange, genre) {
  try {
    const genreMap = {
      adventure: 12,
      animation: 16,
      comedy: 35,
      family: 10751,
      fantasy: 14,
      science_fiction: 878,
      action: 28,
      drama: 18,
      mystery: 9648,
      romance: 10749,
      thriller: 53,
      horror: 27,
      documentary: 99,
      crime: 80,
      war: 10752
    };

    const genreId = genreMap[genre.toLowerCase()] || 10751; // Default to "Family" genre

    // Fetch movies
    const movieUrl = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&with_genres=${genreId},10751&certification_country=US&certification.lte=PG&include_adult=false&sort_by=popularity.desc`;
    const movieResponse = await fetch(movieUrl);
    const movieData = await movieResponse.json();

    // Fetch TV shows
    const tvUrl = `https://api.themoviedb.org/3/discover/tv?api_key=${TMDB_API_KEY}&with_genres=${genreId},10751&include_adult=false&sort_by=popularity.desc`;
    const tvResponse = await fetch(tvUrl);
    const tvData = await tvResponse.json();

    const movies = movieData.results ? movieData.results.map(item => ({
      id: item.id,
      title: item.title,
      description: item.overview,
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : '',
      videoUrl: `https://www.themoviedb.org/movie/${item.id}`
    })) : [];

    const tvShows = tvData.results ? tvData.results.map(item => ({
      id: item.id,
      title: item.name, // TV shows use "name" instead of "title"
      description: item.overview,
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : '',
      videoUrl: `https://www.themoviedb.org/tv/${item.id}`
    })) : [];

    return [...movies, ...tvShows]; // Merge results
  } catch (error) {
    console.error('Error fetching from TMDb:', error);
    return [];
  }
}