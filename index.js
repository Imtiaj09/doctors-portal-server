const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken'); //for jwt token required
require('dotenv').config();

const port = process.env.PORT || 5000;

const app = express();

//middleware
app.use(cors());
app.use(express.json());



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.vep38nb.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send('unauthorized access');
  }

  const token = authHeader.split(' ')[1];

  jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: 'forbidden access' })
    }
    req.decoded = decoded;
    next();
  })
};


async function run() {
  try {
    const appointmentOptionCollection = client.db('doctorsPortal').collection('appointmentOptions');
    const bookingCollection = client.db('doctorsPortal').collection('bookings');
    const usersCollection = client.db('doctorsPortal').collection('users');
    const doctorsCollection = client.db('doctorsPortal').collection('doctors');

    //NOTE: Make sure you use verifyAdmin after verifyJWT
    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);

      if (user?.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access' })
      }
      next();
    }


    //Use Aggregate to query multiple collection and then merge data
    app.get('/appointmentOptions', async (req, res) => {
      const date = req.query.date;
      const query = {};
      const options = await appointmentOptionCollection.find(query).toArray();

      //get the bookings of the provided date
      const bookingQuery = { appointmentDate: date };
      const alreadyBooked = await bookingCollection.find(bookingQuery).toArray();

      //code carefully :D
      options.forEach(option => {
        const optionBooked = alreadyBooked.filter(book => book.treatment === option.name);
        const bookedSlots = optionBooked.map(book => book.slot);
        const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot));
        option.slots = remainingSlots;
      })
      res.send(options)
    });

    //for selected name field in all data
    app.get('/appointmentSpecialty', async (req, res) => {
      const query = {};
      const result = await appointmentOptionCollection.find(query).project({ name: 1 }).toArray();
      res.send(result)

    })

    /*** 
    * API Naming Convention
    * app.get('/bookings') // data get korte caile 
    * app.get('/bookings/:id')
    * app.post('/bookings') // create korte caile
    * app.patch('/bookings/:id')
    * app.delete('/bookings/:id')
    */

    app.get('/bookings', verifyJWT, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;

      if (email !== decodedEmail) {
        return res.status(403).send({ message: 'forbidden access' })
      }

      const query = { email: email };
      const bookings = await bookingCollection.find(query).toArray();
      res.send(bookings)

    });

    app.post('/bookings', async (req, res) => {
      const booking = req.body;
      console.log(booking);
      const query = {
        appointmentDate: booking.appointmentDate,
        email: booking.email,
        treatment: booking.treatment
      };

      const alreadyBooked = await bookingCollection.find(query).toArray();

      if (alreadyBooked.length) {
        const message = `You already have a booking on ${booking.appointmentDate}`
        return res.send({ acknowledged: false, message })
      }


      const result = await bookingCollection.insertOne(booking);
      res.send(result);
    });

    //API for JWT token (with get email)
    app.get('/jwt', async (req, res) => {
      const email = req.query.email;
      const query = { email: email }
      const user = await usersCollection.findOne(query)
      if (user) {
        const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1d' })
        return res.send({ accessToken: token })
      }
      res.status(403).send({ accessToken: '' })
    });


    //for get all user and verify is it a admin or not
    app.get('/users', verifyJWT, async (req, res) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail }; // only one email data
      const queryAll = {}; // for all email data
      const user = await usersCollection.findOne(query);
      if (user.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access' })
      }
      const users = await usersCollection.find(queryAll).toArray();
      res.send(users);
    })

    //for users data
    app.post('/users', async (req, res) => {
      const user = req.body;
      console.log(user)
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    //API of Is the user is admin or not 
    app.get('/users/admin/:email', async (req, res) => {
      const email = req.params.email
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ isAdmin: user?.role === 'admin' });
    })

    //Admit access and verify by JWT 
    app.put('/users/admin/:id', verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) }
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          role: 'admin'
        }
      }
      const result = await usersCollection.updateOne(filter, updatedDoc, options);
      res.send(result);
    });

    //get all the added doctors from mongodb from doctorsCollection
    app.get('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
      const query = {};
      const doctors = await doctorsCollection.find(query).toArray();
      res.send(doctors)
    })

    //API for doctor list
    app.post('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorsCollection.insertOne(doctor);
      res.send(result);
    });

    //API for delete 
    app.delete('/doctors/:id', verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const result = await doctorsCollection.deleteOne(filter);
      res.send(result);
    });

  }
  finally {

  }
}
run().catch(console.log())

app.get('/', async (req, res) => {
  res.send('Doctor Portal Service is running')
});

app.listen(port, () => console.log(`Doctor Portal Is Running on ${port}`))