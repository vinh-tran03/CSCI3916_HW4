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

router.post('/signup', function(req, res) {
    if (!req.body.username || !req.body.password) {
        res.json({success: false, msg: 'Please include both username and password to signup.'})
    } else {
        var user = new User();
        user.name = req.body.name;
        user.username = req.body.username;
        user.password = req.body.password;

        user.save(function(err){
            if (err) {
                if (err.code == 11000)
                    return res.json({ success: false, message: 'A user with that username already exists.'});
                else
                    return res.json(err);
            }

            res.json({success: true, msg: 'Successfully created new user.'})
        });
    }
});

router.post('/signin', function (req, res) {
    var userNew = new User();
    userNew.username = req.body.username;
    userNew.password = req.body.password;

    User.findOne({ username: userNew.username }).select('name username password').exec(function(err, user) {
        if (err) {
            res.send(err);
        }

        user.comparePassword(userNew.password, function(isMatch) {
            if (isMatch) {
                var userToken = { id: user.id, username: user.username };
                var token = jwt.sign(userToken, process.env.SECRET_KEY);
                res.json ({success: true, token: 'JWT ' + token});
            }
            else {
                res.status(401).send({success: false, msg: 'Authentication failed.'});
            }
        })
    })
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
  .post(authJwtController.isAuthenticated, async (req, res) => {
      try {
          const { movieId, username, review, rating } = req.body;

          if (!movieId || !username || !review || rating === undefined) {
              return res.status(400).json({ message: 'All fields are required' });
          }

          const newReview = new Review({
              movieId,
              username,
              review,
              rating
          });

          await newReview.save();
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


