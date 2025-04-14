/*
CSC3916 HW4
File: Server.js
Description: Web API scaffolding for Movie API
 */
const mongoose = require('mongoose');
var express = require('express');
var bodyParser = require('body-parser');
var passport = require('passport');
var authController = require('./auth');
var authJwtController = require('./auth_jwt');
var jwt = require('jsonwebtoken');
var cors = require('cors');
var User = require('./Users');
var Movie = require('./Movies');
var Review = require('./Reviews');

var app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.use(passport.initialize());

var router = express.Router();

function getJSONObjectForMovieRequirement(req) {
    var json = {
        headers: "No headers",
        key: process.env.UNIQUE_KEY,
        body: "No body"
    };

    if (req.body != null) {
        json.body = req.body;
    }

    if (req.headers != null) {
        json.headers = req.headers;
    }

    return json;
}

router.post('/signup', async (req, res) => { // Use async/await
  if (!req.body.username || !req.body.password) {
    return res.status(400).json({ success: false, msg: 'Please include both username and password to signup.' }); // 400 Bad Request
  }

  try {
    const user = new User({ // Create user directly with the data
      name: req.body.name,
      username: req.body.username,
      password: req.body.password,
    });

    await user.save(); // Use await with user.save()

    res.status(201).json({ success: true, msg: 'Successfully created new user.' }); // 201 Created
  } catch (err) {
    if (err.code === 11000) { // Strict equality check (===)
      return res.status(409).json({ success: false, message: 'A user with that username already exists.' }); // 409 Conflict
    } else {
      console.error(err); // Log the error for debugging
      return res.status(500).json({ success: false, message: 'Something went wrong. Please try again later.' }); // 500 Internal Server Error
    }
  }
});


router.post('/signin', async (req, res) => { // Use async/await
  try {
    const user = await User.findOne({ username: req.body.username }).select('name username password');

    if (!user) {
      return res.status(401).json({ success: false, msg: 'Authentication failed. User not found.' }); // 401 Unauthorized
    }

    const isMatch = await user.comparePassword(req.body.password); // Use await

    if (isMatch) {
      const userToken = { id: user._id, username: user.username }; // Use user._id (standard Mongoose)
      const token = jwt.sign(userToken, process.env.SECRET_KEY, { expiresIn: '1h' }); // Add expiry to the token (e.g., 1 hour)
      res.json({ success: true, token: 'JWT ' + token });
    } else {
      res.status(401).json({ success: false, msg: 'Authentication failed. Incorrect password.' }); // 401 Unauthorized
    }
  } catch (err) {
    console.error(err); // Log the error
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again later.' }); // 500 Internal Server Error
  }
});

router.route('/movies/:movieID')
  .get(authJwtController.isAuthenticated, async (req, res) => {
    try {
      const movieId = req.params.movieID;
      const includeReviews = req.query.reviews === 'true';

      if (includeReviews) {
        // Perform aggregation to join movie with reviews using $lookup
        const moviesWithReviews = await Movie.aggregate([
          {
            $match: { _id: mongoose.Types.ObjectId(movieId) } // Match the movie by movieId
          },
          {
            $lookup: {
              from: "reviews", // name of the foreign collection (reviews collection)
              localField: "_id", // field in the Movie collection
              foreignField: "movieId", // field in the Review collection
              as: "reviews" // name of the new field where reviews will be added
            }
          },
          {
            $addFields: {
              averageRating: { $avg: "$reviews.rating" } // Add average rating for the movie
            }
          },
          {
            $sort: {
              averageRating: -1, // Sort by averageRating in descending order
              title: 1 // If the rating is the same, sort alphabetically by title
            }
          }
        ]);

        if (!moviesWithReviews.length) {
          return res.status(404).json({ message: "Movie not found" });
        }

        res.status(200).json({ success: true, movies: moviesWithReviews });
      } else {
        // If reviews are not requested, just retrieve the movie
        const movie = await Movie.findById(movieId);

        if (!movie) {
          return res.status(404).json({ message: "Movie not found" });
        }

        res.status(200).json({ success: true, movie });
      }
    } catch (error) {
      res.status(500).json({ success: false, message: "Error retrieving movie", error: error.message });
    }
});

router.route('/movies')
  .get(authJwtController.isAuthenticated, async (req, res) => {
    try {
      // Aggregation to get all movies with reviews and average rating
      const moviesWithReviews = await Movie.aggregate([
        {
          $lookup: {
            from: "reviews", // name of the foreign collection (reviews collection)
            localField: "_id", // field in the Movie collection
            foreignField: "movieId", // field in the Review collection
            as: "reviews" // name of the new field where reviews will be added
          }
        },
        {
          $addFields: {
            averageRating: { $avg: "$reviews.rating" } // Add average rating for the movie
          }
        },
        {
          $sort: {
            averageRating: -1, // Sort by averageRating in descending order
            title: 1 // If the rating is the same, sort alphabetically by title
          }
        }
      ]);

      res.status(200).json({ success: true, movies: moviesWithReviews });
    } catch (error) {
      res.status(500).json({ success: false, message: "Error retrieving movies", error: error.message });
    }
});

router.route('/review')
  .get(authJwtController.isAuthenticated, async (req, res) => {
      try {
          const reviews = await Review.find().populate('movieId');
          res.status(200).json(reviews);
      } catch (err) {
          res.status(500).json({ message: err.message });
      }
  })

// POST a new review (requires JWT auth)
router.route('/review')
.post(authJwtController.isAuthenticated, async (req, res) => {
  try {
    const { movieId, username, review, rating } = req.body;

    // Check if all required fields are provided
    if (!movieId || !username || !review || rating === undefined) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Check if the movie exists in the database
    const movie = await Movie.findById(movieId);
    if (!movie) {
      return res.status(404).json({ message: 'Movie not found' });
    }

    // Create a new review since the movie exists
    const newReview = new Review({
      movieId,
      username,
      review,
      rating
    });

    // Save the review to the database
    await newReview.save();

    // Send a success response
    res.status(201).json({ message: 'Review created!' });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Optional DELETE route
router.route('/review/:id')
  .delete(authJwtController.isAuthenticated, async (req, res) => {
      try {
          const deleted = await Review.findByIdAndDelete(req.params.id);
          if (!deleted) {
              return res.status(404).json({ message: 'Review not found' });
          }
          res.status(200).json({ message: 'Review deleted' });
      } catch (err) {
          res.status(500).json({ message: err.message });
      }
});

app.use('/', router);
app.listen(process.env.PORT || 8080);
module.exports = app; // for testing only


